from fastapi import FastAPI
from sqlalchemy import select
from app.database import engine, Base, AsyncSessionLocal
from app.models import User
from app.config import settings
from app.auth import hash_password

app = FastAPI(title=settings.PROJECT_NAME)

async def init_db_and_seed_admin():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed Admin User automatically if not existing
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
        admin = result.scalar_one_or_none()
        
        if not admin:
            admin_user = User(
                full_name=settings.ADMIN_NAME,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD)
            )
            db.add(admin_user)
            await db.commit()
            print(f"✅ Admin user initialized: {settings.ADMIN_EMAIL}")

@app.on_event("startup")
async def startup_event():
    await init_db_and_seed_admin()

# --- AUTH ---
@app.post("/api/auth/register", response_model=UserResponse)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    new_user = User(
        full_name=user_data.full_name,
        email=user_data.email,
        phone=user_data.phone,
        hashed_password=hash_password(user_data.password)
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user

@app.post("/api/auth/login", response_model=Token)
async def login(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == user_data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")
    
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}

# --- DESIGNS CATALOG ---
@app.get("/api/designs", response_model=List[DesignResponse])
async def get_designs(category: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = select(Design)
    if category:
        query = query.where(Design.category == category)
    result = await db.execute(query)
    return result.scalars().all()

# --- MEASUREMENT PROFILES ---
@app.post("/api/measurements", response_model=MeasurementProfileResponse)
async def create_measurement_profile(
    profile: MeasurementProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    new_profile = MeasurementProfile(**profile.model_dump(), user_id=current_user.id)
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)
    return new_profile

@app.get("/api/measurements", response_model=List[MeasurementProfileResponse])
async def get_my_measurement_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(MeasurementProfile).where(MeasurementProfile.user_id == current_user.id)
    )
    return result.scalars().all()

# --- ORDERS ---
@app.post("/api/orders", response_model=OrderResponse)
async def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    total_amount = 0.0
    items_to_create = []

    for item in order_data.items:
        design = await db.get(Design, item.design_id)
        if not design:
            raise HTTPException(status_code=404, detail=f"Design {item.design_id} not found")

        total_amount += design.base_price
        items_to_create.append(
            OrderItem(
                design_id=design.id,
                measurement_profile_id=item.measurement_profile_id,
                fabric_choice=item.fabric_choice,
                custom_instructions=item.custom_instructions,
                price=design.base_price
            )
        )

    new_order = Order(
        user_id=current_user.id,
        address_id=order_data.address_id,
        total_amount=total_amount,
        order_items=items_to_create
    )

    db.add(new_order)
    await db.commit()

    # Re-fetch order with preloaded relationships for response validation
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.order_items).selectinload(OrderItem.design))
        .options(selectinload(Order.order_items).selectinload(OrderItem.measurement_profile))
        .where(Order.id == new_order.id)
    )
    return result.scalar_one()