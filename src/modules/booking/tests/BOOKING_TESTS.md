# Booking Module Test Suite

## Architecture
The booking tests follow a 3-tier clean architecture:

```
src/modules/booking/tests/
├── booking-slots.util.spec.ts   # Layer 1: Pure functions (zero mocks, fastest)
├── booking.service.spec.ts      # Layer 2: Domain & DB business logic (mocked Prisma)
└── booking.tool.spec.ts         # Layer 3: LangChain AI tool adapter (mocked Service & Tx)
```

---

## 1. Pure Slot Utilities (`booking-slots.util.spec.ts`)
Tests standalone date and time calculation logic with no external dependencies.

| Function | Test Case | Example Input | Expected Output |
| :--- | :--- | :--- | :--- |
| `getDayOfWeek` | Day mapping | `'2026-08-25'` | `'TUESDAY'` |
| `getNextDayStr` | Month rollover | `'2026-01-31'` | `'2026-02-01'` |
| `getNextDayStr` | Year rollover | `'2026-12-31'` | `'2027-01-01'` |
| `normalizeTime` | Single-digit pad | `'9:00'` | `'09:00'` |
| `formatTime` | Date to string | `Date(2026-08-25 09:05)` | `'09:05'` |
| `isWithinWorkingHours` | Inside window | `09:00 - 09:30` in `09:00 - 17:00` | `true` |
| `isWithinWorkingHours` | Starts too early | `08:30 - 09:30` in `09:00 - 17:00` | `false` |
| `hasConflict` | Adjacent touch | Slot `09:30-10:00` vs Booking `09:00-09:30` | `false` (No conflict) |
| `hasConflict` | Partial overlap | Slot `09:45-10:15` vs Booking `10:00-10:30` | `true` (Conflict) |
| `generateTimeSlots` | Duration bounds | `09:00-11:00`, step `30m`, duration `45m` | `['09:00', '09:30', '10:00']` |
| `findAvailableSlots` | Filter bookings | Slots in `09:00-12:00`, booking at `09:30`, `11:00` | `['09:00', '10:00', '10:30', '11:30']` |

---

## 2. Domain Booking Service (`booking.service.spec.ts`)
Tests business rules, database queries, and multi-doctor resolution.

| Scenario | Given State | When | Then |
| :--- | :--- | :--- | :--- |
| **Service Not Found** | Service not in DB | Request `'Consultation'` | Returns `SERVICE_NOT_FOUND` |
| **Doctor Not Available** | Doctor doesn't offer service | Request `'Dr. House'` for `'Consultation'` | Returns `DOCTOR_NOT_AVAILABLE` (`"Doctor 'Dr. House' does not offer 'Consultation'."`) |
| **Happy Path Booking** | Doctor works `09:00-17:00`, no conflicts | Request `10:00` | Returns `CONFIRMED`, creates DB record with `tenant_id`, `doctor_id`, `service_id`, `client_phone` |
| **Outside Hours** | Doctor works `09:00-12:00` | Request `15:00` | Returns `UNAVAILABLE` (`OUTSIDE_HOURS`), DB create skipped, returns alternatives for current & next day |
| **Slot Booked** | Doctor has booking `10:00-10:30` | Request `10:00` | Returns `UNAVAILABLE` (`ALREADY_BOOKED`), DB create skipped, returns alternative open slots |
| **Multi-Doctor Conflict Fallback** | Dr. Alice booked at `10:00`, Dr. Bob free at `10:00` | Request `10:00` | Returns `CONFIRMED` assigned to Dr. Bob |
| **Multi-Doctor Schedule Fallback** | Dr. Alice works morning, Dr. Bob works afternoon | Request `14:00` | Returns `CONFIRMED` assigned to Dr. Bob |

---

## 3. LangChain AI Tool Adapter (`booking.tool.spec.ts`)
Tests parameter extraction, tenant RLS isolation, and user-facing response formatting.

| Scenario | Input / Mocked Service Result | Output / Behavior |
| :--- | :--- | :--- |
| **Missing Tenant / Phone** | `configurable: {}` (no `tenantId`) | Throws `"Tenant context or phone number missing from tool execution"` |
| **Tenant Transaction Scope** | Valid config + params | Runs inside `tenantTransaction.run('tenant-123', ...)` |
| **Confirmed Booking** | `CONFIRMED` (Dr. Alice, `2026-08-25`, `10:00`, `booking-abc`) | `"Booking confirmed with Dr. Alice on 2026-08-25 at 10:00. Booking id: booking-abc"` |
| **Unavailable (Outside Hours)** | `UNAVAILABLE` (`OUTSIDE_HOURS`, 2 alternatives) | Prefix: `"The requested time (15:00 on 2026-08-25) is outside working hours. Available alternatives: ..."` |
| **Unavailable (Booked)** | `UNAVAILABLE` (`ALREADY_BOOKED`, 1 alternative) | Prefix: `"Requested slot (10:00 on 2026-08-25) is already booked. Available alternatives: ..."` |
| **No Availability Found** | `UNAVAILABLE` with 0 alternatives | `"No working hours or availability found for 'Consultation' on 2026-08-25 or 2026-08-26."` |
