
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="PayPilot AI API",
    description="AI-assisted commerce and payment workflow for businesses",
    version="0.1.0",
)

# Allow the local React development server to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class PurchaseRequest(BaseModel):
    product: str = Field(min_length=2, max_length=150)
    budget: float = Field(gt=0, le=100_000_000)
    quantity: int = Field(default=1, ge=1, le=100_000)


@app.get("/")
def root():
    return {
        "app": "PayPilot AI",
        "message": "Backend API is running",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "app": "PayPilot AI",
        "version": "0.1.0",
    }


@app.post("/api/purchase/recommend")
def recommend_purchase(request: PurchaseRequest):
    # This is a demonstration calculation, not a live product search
    # or an AI model. Real product data and AI will be added later.
    budget_per_item = request.budget / request.quantity

    return {
        "product_requested": request.product,
        "quantity": request.quantity,
        "total_budget": round(request.budget, 2),
        "budget_per_item": round(budget_per_item, 2),
        "recommendation": (
            "Your purchase request is ready for product comparison."
        ),
        "data_source": "demo",
        "payment_status": "not_started",
        "requires_user_approval": True,
    }
