# PayPilot AI

AI-assisted commerce and payment workflow for small and medium-sized businesses.

## Current features

- React and Vite dashboard
- FastAPI backend
- Purchase request form
- Budget-per-item calculation
- API health endpoint
- Explicit user approval planned before payment

## Technology stack

- Frontend: React, Vite
- Backend: Python, FastAPI, Uvicorn
- Database: MongoDB integration planned
- Payments: PayPal Sandbox integration planned

## Run locally

### Backend

```bash
cd backend
python -m venv venv
```

Activate the virtual environment on Windows:

```bat
venv\Scripts\activate
```

Install dependencies and start the API:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

API documentation: http://127.0.0.1:8000/docs

### Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173/

## Development status

This is an early development prototype. Product discovery, persistent storage, AI recommendations, and PayPal payment processing must be implemented and tested before production use.

Never commit real payment credentials or other secrets.
