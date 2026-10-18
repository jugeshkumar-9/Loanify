import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware

# Files saved at the end of the notebook
model = joblib.load('model.pkl')                      # GaussianNB classifier
scaler = joblib.load('scaler.pkl')                    # StandardScaler (fit on training columns)
feature_columns = joblib.load('feature_columns.pkl')  # exact training column order

# ---- Every column this API knows how to fill -------------------------------
NUMERIC_COLS = [
    'Applicant_Income', 'Coapplicant_Income', 'Age', 'Dependents', 'Existing_Loans',
    'Savings', 'Collateral_Value', 'Loan_Amount', 'Loan_Term', 'Education_Level',
    'DTI_ratio-sq', 'Credit_Score-sq',
    'Applicant_Income_log',          # log1p(Applicant_Income), present in some notebook runs
]
ONE_HOT_OPTIONS = {
    'Employment_Status': ['Salaried', 'Self-employed', 'Unemployed', 'Contract'],
    'Marital_Status'   : ['Married', 'Single'],
    'Loan_Purpose'     : ['Business', 'Car', 'Education', 'Home', 'Personal'],
    'Property_Area'    : ['Rural', 'Semiurban', 'Urban'],
    'Gender'           : ['Female', 'Male'],
    'Employer_Category': ['Government', 'MNC', 'Private', 'Unemployed', 'Business'],
}
KNOWN = set(NUMERIC_COLS) | {f'{p}_{v}' for p, vals in ONE_HOT_OPTIONS.items() for v in vals}

# Stop at startup if the model expects a column we would silently fill with 0.
# (A column left at 0 gets scaled to a huge outlier and wrecks the prediction.)
unknown = [c for c in feature_columns if c not in KNOWN]
if unknown:
    raise RuntimeError(
        f'feature_columns.pkl contains columns this API does not fill: {unknown}. '
        'Add them to NUMERIC_COLS and compute them in build_input_row().'
    )

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# A first Pydantic Model: what the UI sends us
class ApplicantData(BaseModel):
    applicant_income   : float = Field(..., gt=0)
    coapplicant_income : float = Field(..., ge=0)
    age                : int   = Field(..., ge=18, le=75)
    dependents         : int   = Field(..., ge=0, le=10)
    credit_score       : float = Field(..., ge=300, le=900)
    existing_loans     : int   = Field(..., ge=0, le=10)
    dti_ratio          : float = Field(..., ge=0, le=1)
    savings            : float = Field(..., ge=0)
    collateral_value   : float = Field(..., ge=0)
    loan_amount        : float = Field(..., gt=0)
    loan_term          : Literal[12, 24, 36, 48, 60, 72, 84]
    education_level    : Literal['Graduate', 'Not Graduate']
    employment_status  : Literal['Salaried', 'Self-employed', 'Unemployed', 'Contract']
    marital_status     : Literal['Married', 'Single']
    loan_purpose       : Literal['Business', 'Car', 'Education', 'Home', 'Personal']
    property_area      : Literal['Rural', 'Semiurban', 'Urban']
    gender             : Literal['Female', 'Male']
    employer_category  : Literal['Government', 'MNC', 'Private', 'Unemployed', 'Business']


# Describe what we send back
class PredictionResponse(BaseModel):
    loan_approved        : bool
    prediction           : Literal['Approved', 'Rejected']
    approval_probability : float   # percentage, e.g. 82.45


def build_input_row(data: ApplicantData) -> pd.DataFrame:
    """Rebuild exactly the columns the model was trained on."""
    row = dict.fromkeys(feature_columns, 0.0)   # dropped one-hot baselines stay 0

    values = {
        'Applicant_Income'   : data.applicant_income,
        'Coapplicant_Income' : data.coapplicant_income,
        'Age'                : data.age,
        'Dependents'         : data.dependents,
        'Existing_Loans'     : data.existing_loans,
        'Savings'            : data.savings,
        'Collateral_Value'   : data.collateral_value,
        'Loan_Amount'        : data.loan_amount,
        'Loan_Term'          : data.loan_term,
        # LabelEncoder order: Graduate = 0, Not Graduate = 1
        'Education_Level'    : 0 if data.education_level == 'Graduate' else 1,
        # engineered features from the notebook
        'DTI_ratio-sq'       : data.dti_ratio ** 2,
        'Credit_Score-sq'    : data.credit_score ** 2,
        'Applicant_Income_log': float(np.log1p(data.applicant_income)),
    }
    for col, val in values.items():
        if col in row:                  # only fill what the model actually uses
            row[col] = val

    chosen = {
        'Employment_Status': data.employment_status,
        'Marital_Status'   : data.marital_status,
        'Loan_Purpose'     : data.loan_purpose,
        'Property_Area'    : data.property_area,
        'Gender'           : data.gender,
        'Employer_Category': data.employer_category,
    }
    for prefix, value in chosen.items():
        col = f'{prefix}_{value}'
        if col in row:                  # baseline category has no column -> stays 0
            row[col] = 1.0

    return pd.DataFrame([row])[feature_columns]


@app.get('/')
def greet():
    return {'message': 'CreditWise Loan Approval API is running'}


@app.get('/health')
def health():
    return {'status': 'ok', 'n_features': len(feature_columns)}


@app.post('/predict', response_model=PredictionResponse)
def predict(data: ApplicantData):
    input_scaled = scaler.transform(build_input_row(data))

    pred = int(model.predict(input_scaled)[0])               # 1 = Yes, 0 = No
    prob = float(model.predict_proba(input_scaled)[0][1])    # P(approved)

    return PredictionResponse(
        loan_approved=bool(pred),
        prediction='Approved' if pred == 1 else 'Rejected',
        approval_probability=round(prob * 100, 2),
    )