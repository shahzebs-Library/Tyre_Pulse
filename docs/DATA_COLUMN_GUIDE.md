# Import Column Guide

Exact columns each import understands. Headers below auto-map at 100%. Column order does not matter; blank cells are allowed; unknown columns are preserved as custom fields.

## Fleet / Assets (16 columns, 1 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Asset No. | string | **Yes** |  |
| Fleet Number | string | No |  |
| Make | string | No |  |
| Model | string | No |  |
| Vehicle Type | string | No |  |
| Year | integer | No |  |
| Department | string | No |  |
| Operator | string | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Region | string | No |  |
| Tyre Size | string | No |  |
| Status | string | No |  |
| Current KM | distance | No |  |
| Registration No. | string | No |  |
| Notes / Remarks | string | No |  |

## Tyre Lifecycle (24 columns, 2 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Serial No. | string | **Yes** |  |
| Asset No. | string | **Yes** |  |
| Brand | string | No |  |
| Size | string | No |  |
| Position | string | No |  |
| Pressure | pressure | No |  |
| Tread Depth | number | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Unit Cost / Tyre | currency | No |  |
| Quantity | integer | No |  |
| Total Amount | currency | No | auto-split by Qty |
| KM at Fitment | distance | No |  |
| KM at Removal | distance | No |  |
| Removal Reason | string | No |  |
| Supplier | string | No |  |
| Issue / Fitment Date | date | No |  |
| Removal Date | date | No |  |
| Job Card No. | string | No |  |
| Vehicle Type | string | No |  |
| Hours at Fitment | number | No |  |
| Hours at Removal | number | No |  |
| Total KM (Tyre Life) | distance | No |  |
| Total Hours (Tyre Life) | number | No |  |

## Stock (8 columns, 3 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Site | string | **Yes** |  |
| Description | string | **Yes** |  |
| Stock Qty | number | **Yes** |  |
| Min Level | number | No |  |
| Critical Level | number | No |  |
| Reorder Qty | number | No |  |
| Region | string | No |  |
| Country | string | No |  |

## Accidents / Insurance (24 columns, 2 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Asset No. | string | **Yes** |  |
| Incident Date | date | **Yes** |  |
| Incident Time | string | No |  |
| Location | string | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Accident Type | string | No |  |
| Severity | string | No |  |
| Description | string | No |  |
| Damage Description | string | No |  |
| Driver / Operator | string | No |  |
| Police Report No. | string | No |  |
| Insurer | string | No |  |
| Policy No. | string | No |  |
| Claim No. | string | No |  |
| Claim Status | string | No |  |
| Claim Amount | currency | No |  |
| Approved Amount | currency | No |  |
| Recovered Amount | currency | No |  |
| Deductible / Excess | currency | No |  |
| Estimated Cost | currency | No |  |
| Actual Repair Cost | currency | No |  |
| Parts Cost | currency | No |  |
| Closure Status | string | No |  |

## Inspections (12 columns, 2 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Asset No. | string | **Yes** |  |
| Inspection Date | date | **Yes** |  |
| Inspection Type | string | No |  |
| Inspector | string | No |  |
| Tyre Serial | string | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Status | string | No |  |
| Severity | string | No |  |
| Findings | string | No |  |
| Odometer KM | distance | No |  |
| Pressure | pressure | No |  |

## Work Orders (28 columns, 1 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Work Order No. | string | **Yes** |  |
| Asset No. | string | No |  |
| Tyre Serial | string | No |  |
| Tyre Position | string | No |  |
| Work Type | string | No |  |
| Status | string | No |  |
| Priority | string | No |  |
| Complaint / Description | string | No |  |
| Notes / Job Done | string | No |  |
| Technician | string | No |  |
| Workshop | string | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Opened / In Date | date | No |  |
| Started | date | No |  |
| Completed / Out Date | date | No |  |
| Target Completion | date | No |  |
| Labour Hours | number | No |  |
| Labour Rate | currency | No |  |
| Labour Cost | currency | No |  |
| Parts Cost | currency | No |  |
| Lubricant Cost | currency | No |  |
| Tyre Cost | currency | No |  |
| Outside Repair Cost | currency | No |  |
| Breakdown Hours | number | No |  |
| Standard Hours | number | No |  |
| Odometer (KM/HR) | number | No |  |
| Total Cost | currency | No |  |

## Warranty Claims (15 columns, 1 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Tyre Serial | string | **Yes** |  |
| Claim No. | string | No |  |
| Brand | string | No |  |
| Size | string | No |  |
| Asset No. | string | No |  |
| Site | string | No |  |
| Country | string | No |  |
| Fitment Date | date | No |  |
| Removal Date | date | No |  |
| KM at Fitment | distance | No |  |
| KM at Removal | distance | No |  |
| Failure Type | string | No |  |
| Supplier | string | No |  |
| Claim Status | string | No |  |
| Credit Amount | currency | No |  |

## Gate Pass (7 columns, 2 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Asset No. | string | **Yes** |  |
| Pass Date | date | **Yes** |  |
| Site | string | No |  |
| Country | string | No |  |
| Status | string | No |  |
| Denial Reason | string | No |  |
| Notes | string | No |  |

## Suppliers (11 columns, 1 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Supplier Name | string | **Yes** |  |
| Supplier Code | string | No |  |
| Supplier Type | string | No |  |
| Contact Person | string | No |  |
| Phone | string | No |  |
| Email | string | No |  |
| Site | string | No |  |
| Region | string | No |  |
| Country | string | No |  |
| Rating | number | No |  |
| Status | string | No |  |

## Drivers (11 columns, 2 required)

| Column header | Type | Required | Notes |
|---|---|---|---|
| Driver ID | string | **Yes** |  |
| Driver Name | string | **Yes** |  |
| License No. | string | No |  |
| License Expiry | date | No |  |
| Phone | string | No |  |
| Nationality | string | No |  |
| Assigned Asset | string | No |  |
| Site | string | No |  |
| Region | string | No |  |
| Country | string | No |  |
| Status | string | No |  |

## Cost columns (tyre)
Use **Unit Cost / Tyre** for per-tyre price, OR **Total Amount** for the line total (price already ×qty, as most ERP exports give) and the system divides by Quantity. Do not fill both.
