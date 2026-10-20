import os
import uuid
from datetime import datetime, timezone

import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.errors import PyMongoError

load_dotenv()

app = FastAPI(
    title="PayPilot AI API",
    description="AI-assisted commerce and payment workflow",
    version="0.3.0",
)

# Local development works by default. Add the deployed Vercel origin to
# FRONTEND_ORIGINS when deploying, e.g. https://your-app.vercel.app
frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,https://paypilot-ai-ten.vercel.app"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# MongoDB configuration
mongodb_uri = os.getenv("MONGODB_URI")
database_name = os.getenv("MONGODB_DATABASE", "paypilot_ai")

mongo_client = (
    MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
    if mongodb_uri
    else None
)

database = mongo_client[database_name] if mongo_client else None

purchase_collection = (
    database["purchase_requests"] if database is not None else None
)

paypal_checkouts_collection = (
    database["paypal_checkouts"] if database is not None else None
)


# PayPal Sandbox configuration
PAYPAL_BASE_URL = os.getenv(
    "PAYPAL_BASE_URL",
    "https://api-m.sandbox.paypal.com",
).rstrip("/")

PAYPAL_TEST_AMOUNT = "1.00"
PAYPAL_TEST_CURRENCY = "USD"


class PurchaseRequest(BaseModel):
    product: str = Field(min_length=2, max_length=150)
    budget: float = Field(gt=0, le=100_000_000)
    quantity: int = Field(default=1, ge=1, le=100_000)


class PayPalCreateOrderRequest(BaseModel):
    purchase_request_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )


class PayPalCaptureRequest(BaseModel):
    order_id: str = Field(min_length=5, max_length=100)


class AgentAnalysisRequest(BaseModel):
    purchase_request_id: str = Field(min_length=1, max_length=100)


def get_paypal_access_token() -> str:
    client_id = os.getenv("PAYPAL_CLIENT_ID")
    client_secret = os.getenv("PAYPAL_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail="PayPal Sandbox credentials are not configured.",
        )

    try:
        response = requests.post(
            f"{PAYPAL_BASE_URL}/v1/oauth2/token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={
                "Accept": "application/json",
                "Accept-Language": "en_US",
            },
            timeout=20,
        )

        response.raise_for_status()
        token_data = response.json()

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Could not obtain an access token from PayPal.",
        )

    access_token = token_data.get("access_token")

    if not access_token:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return an access token.",
        )

    return access_token


def serialize_mongo_document(document: dict) -> dict:
    serialized = {}

    for key, value in document.items():
        if isinstance(value, ObjectId):
            serialized[key] = str(value)
        elif isinstance(value, datetime):
            serialized[key] = value.isoformat()
        else:
            serialized[key] = value

    return serialized


def require_mongodb() -> None:
    if purchase_collection is None or paypal_checkouts_collection is None:
        raise HTTPException(
            status_code=503,
            detail="MongoDB is not configured. Set MONGODB_URI.",
        )


@app.get("/")
def root():
    return {
        "service": "PayPilot AI API",
        "status": "running",
        "environment": "sandbox",
    }


@app.get("/api/health")
def health_check():
    mongodb_connected = False

    if database is not None:
        try:
            database.command("ping")
            mongodb_connected = True
        except PyMongoError:
            mongodb_connected = False

    return {
        "api": "healthy",
        "mongodb": "connected" if mongodb_connected else "not connected",
        "paypal_environment": "sandbox",
    }


@app.post("/api/purchase/recommend")
def create_purchase_request(request: PurchaseRequest):
    require_mongodb()

    budget_per_item = round(request.budget / request.quantity, 2)

    if budget_per_item < 1:
        raise HTTPException(
            status_code=400,
            detail="Budget per item must be at least ₹1.",
        )

    recommendation = (
        f"For {request.quantity} {request.product}, allocate approximately "
        f"₹{budget_per_item:,.2f} per unit. Compare at least three suppliers, "
        "confirm delivery charges and warranty terms, and approve the final "
        "purchase before payment."
    )

    document = {
        "product": request.product.strip(),
        "budget": request.budget,
        "quantity": request.quantity,
        "budget_per_item": budget_per_item,
        "recommendation": recommendation,
        "payment_status": "not_started",
        "created_at": datetime.now(timezone.utc),
    }

    try:
        insert_result = purchase_collection.insert_one(document)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the purchase request to MongoDB.",
        )

    return {
        "id": str(insert_result.inserted_id),
        "product_requested": document["product"],
        "quantity": document["quantity"],
        "total_budget": document["budget"],
        "budget_per_item": document["budget_per_item"],
        "recommendation": document["recommendation"],
        "payment_status": document["payment_status"],
        "saved_to_database": True,
    }


@app.get("/api/purchase/requests")
def get_purchase_requests():
    require_mongodb()

    try:
        documents = list(
            purchase_collection.find().sort("created_at", -1).limit(50)
        )
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not read purchase requests from MongoDB.",
        )

    requests_list = []

    for document in documents:
        requests_list.append(
            {
                "id": str(document["_id"]),
                "product": document.get("product", ""),
                "budget": document.get("budget", 0),
                "quantity": document.get("quantity", 0),
                "payment_status": document.get("payment_status", "not_started"),
                "sandbox_test_payment_status": document.get("sandbox_test_payment_status", "not_started"),
                "created_at": document.get("created_at"),
            }
        )

    return {"requests": requests_list}


@app.post("/api/agents/analyze")
def analyze_purchase_with_agent_grid(request: AgentAnalysisRequest):
    """Run a deterministic multi-agent workflow prototype on a saved request.

    This endpoint is intentionally transparent: it does not claim to use an
    external LLM or live supplier search. Those integrations can be added later.
    """
    require_mongodb()
    if not ObjectId.is_valid(request.purchase_request_id):
        raise HTTPException(status_code=400, detail="Invalid purchase request ID.")
    try:
        purchase = purchase_collection.find_one({"_id": ObjectId(request.purchase_request_id)})
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not load purchase request.")
    if purchase is None:
        raise HTTPException(status_code=404, detail="Purchase request not found.")

    product = str(purchase.get("product", "requested item"))
    quantity = int(purchase.get("quantity", 1))
    budget = float(purchase.get("budget", 0))
    per_item = float(purchase.get("budget_per_item", budget / max(quantity, 1)))
    checklist = [
        f"Research Agent: identify at least three suppliers for {product} and compare delivered prices.",
        f"Budget Agent: use ₹{per_item:,.2f} per item as the target across {quantity} units; total cap ₹{budget:,.2f}.",
        "Risk Agent: verify seller identity, taxes, delivery date, warranty, return terms, and invoice before approval.",
        "Procurement Agent: present the comparison to a human approver; do not place a real order automatically.",
    ]
    summary = (
        f"The agent workflow prepared a procurement checklist for {quantity} {product}. "
        f"Target spend is ₹{budget:,.2f} total (₹{per_item:,.2f} per item). "
        "No live supplier prices were fetched and no purchase or payment was initiated."
    )
    analysis = {
        "purchase_request_id": request.purchase_request_id,
        "workflow_status": "completed_rule_based_prototype",
        "summary": summary,
        "checklist": checklist,
        "agents": ["research", "budget", "risk", "procurement"],
        "uses_external_llm": False,
        "uses_live_supplier_search": False,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        purchase_collection.update_one(
            {"_id": ObjectId(request.purchase_request_id)},
            {"$set": {"agent_analysis": analysis}},
        )
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not save agent analysis.")
    return analysis


@app.post("/api/paypal/create-order")
def create_paypal_order(request: PayPalCreateOrderRequest):
    require_mongodb()

    purchase_request = None

    if request.purchase_request_id:
        try:
            purchase_object_id = ObjectId(request.purchase_request_id)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid purchase request ID.",
            )

        try:
            purchase_request = purchase_collection.find_one(
                {"_id": purchase_object_id}
            )
        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Could not read the purchase request from MongoDB.",
            )

        if purchase_request is None:
            raise HTTPException(
                status_code=404,
                detail="Purchase request not found.",
            )

    access_token = get_paypal_access_token()

    try:
        response = requests.post(
            f"{PAYPAL_BASE_URL}/v2/checkout/orders",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "PayPal-Request-Id": f"paypilot-{uuid.uuid4()}",
            },
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "reference_id": "paypilot-sandbox-test",
                        "description": "PayPilot AI Sandbox payment test",
                        "amount": {
                            "currency_code": PAYPAL_TEST_CURRENCY,
                            "value": PAYPAL_TEST_AMOUNT,
                        },
                    }
                ],
                "application_context": {
                    "brand_name": "PayPilot AI",
                    "user_action": "PAY_NOW",
                    "return_url": f"{FRONTEND_URL}/paypal/return",
                    "cancel_url": f"{FRONTEND_URL}/paypal/cancel",
                },
            },
            timeout=30,
        )

        response.raise_for_status()
        order_data = response.json()

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="PayPal could not create the Sandbox order.",
        )

    order_id = order_data.get("id")

    if not order_id:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return an order ID.",
        )

    approval_url = None

    for link in order_data.get("links", []):
        if link.get("rel") in ("approve", "payer-action"):
            approval_url = link.get("href")
            break

    if not approval_url:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return an approval URL.",
        )

    checkout_document = {
        "paypal_order_id": order_id,
        "purchase_request_id": (
            str(purchase_request["_id"]) if purchase_request else None
        ),
        "amount": PAYPAL_TEST_AMOUNT,
        "currency": PAYPAL_TEST_CURRENCY,
        "status": "CREATED",
        "payment_status": "pending",
        "capture_ids": [],
        "created_at": datetime.now(timezone.utc),
        "completed_at": None,
    }

    try:
        paypal_checkouts_collection.insert_one(checkout_document)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail=(
                "PayPal order was created, but MongoDB could not save "
                "the checkout record."
            ),
        )

    return {
        "order_id": order_id,
        "approval_url": approval_url,
        "amount": PAYPAL_TEST_AMOUNT,
        "currency": PAYPAL_TEST_CURRENCY,
        "purchase_request_id": checkout_document["purchase_request_id"],
        "environment": "sandbox",
    }


@app.post("/api/paypal/capture-order")
def capture_paypal_order(request: PayPalCaptureRequest):
    require_mongodb()

    try:
        checkout = paypal_checkouts_collection.find_one(
            {"paypal_order_id": request.order_id}
        )
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not read the checkout record from MongoDB.",
        )

    if checkout is None:
        raise HTTPException(
            status_code=404,
            detail="This PayPal order is not registered by PayPilot AI.",
        )

    if checkout.get("status") == "COMPLETED":
        sync_sandbox_test_payment_to_purchase(
            checkout,
            checkout.get("capture_ids", []),
            checkout.get("completed_at", datetime.now(timezone.utc)),
        )

        return {
            "order_id": request.order_id,
            "payment_status": "completed",
            "message": (
                "This $1.00 Sandbox test payment has already been verified."
            ),
            "purchase_request_id": checkout.get("purchase_request_id"),
            "environment": "sandbox",
            "note": (
                "This does not mean the INR purchase budget has been paid."
            ),
        }

    access_token = get_paypal_access_token()

    try:
        response = requests.post(
            (
                f"{PAYPAL_BASE_URL}/v2/checkout/orders/"
                f"{request.order_id}/capture"
            ),
            json={},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "PayPal-Request-Id": f"capture-{request.order_id}",
            },
            timeout=30,
        )

        response.raise_for_status()
        capture_result = response.json()

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail=(
                "PayPal could not complete the capture. "
                "Check the order status before retrying."
            ),
        )

    capture_ids = []
    capture_statuses = []

    for unit in capture_result.get("purchase_units", []):
        payments = unit.get("payments", {})

        for capture in payments.get("captures", []):
            capture_ids.append(capture.get("id"))
            capture_statuses.append(capture.get("status"))

    verified = (
        capture_result.get("status") == "COMPLETED"
        and bool(capture_statuses)
        and all(status == "COMPLETED" for status in capture_statuses)
    )

    if not verified:
        raise HTTPException(
            status_code=409,
            detail=(
                "PayPal has not confirmed a completed payment. "
                "The checkout remains unverified."
            ),
        )

    completed_at = datetime.now(timezone.utc)

    try:
        paypal_checkouts_collection.update_one(
            {"paypal_order_id": request.order_id},
            {
                "$set": {
                    "status": "COMPLETED",
                    "payment_status": "completed",
                    "capture_ids": [
                        capture_id
                        for capture_id in capture_ids
                        if capture_id
                    ],
                    "completed_at": completed_at,
                }
            },
        )
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail=(
                "PayPal reports a completed payment, but MongoDB "
                "could not save the result. Check the order before retrying."
            ),
        )

    checkout["capture_ids"] = [
        capture_id for capture_id in capture_ids if capture_id
    ]
    checkout["completed_at"] = completed_at

    linked_to_purchase = sync_sandbox_test_payment_to_purchase(
        checkout,
        capture_ids,
        completed_at,
    )

    return {
        "order_id": request.order_id,
        "payment_status": "completed",
        "capture_ids": [
            capture_id for capture_id in capture_ids if capture_id
        ],
        "amount": checkout["amount"],
        "currency": checkout["currency"],
        "purchase_request_id": checkout.get("purchase_request_id"),
        "linked_to_purchase_request": linked_to_purchase,
        "environment": "sandbox",
        "saved_to_database": True,
    }


def sync_sandbox_test_payment_to_purchase(
    checkout: dict,
    capture_ids: list,
    completed_at: datetime,
) -> bool:
    purchase_request_id = checkout.get("purchase_request_id")

    if not purchase_request_id:
        return False

    try:
        purchase_object_id = ObjectId(purchase_request_id)
    except Exception:
        return False

    try:
        update_result = purchase_collection.update_one(
            {"_id": purchase_object_id},
            {
                "$set": {
                    "payment_status": "sandbox_test_completed",
                    "paypal_order_id": checkout.get("paypal_order_id"),
                    "paypal_capture_ids": [
                        capture_id for capture_id in capture_ids if capture_id
                    ],
                    "sandbox_payment_completed_at": completed_at,
                }
            },
        )
    except PyMongoError:
        return False

    return update_result.modified_count > 0