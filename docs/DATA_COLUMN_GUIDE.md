# Import Column Guide

Exact columns each import understands. Headers below auto-map at 100%. Column order does not matter; blank cells are allowed; unknown columns are preserved as custom fields.

## Tyre records (24 columns, 2 required)

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

## Fleet / vehicles (16 columns, 1 required)

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

## Cost columns (tyre)
Use **Unit Cost / Tyre** for per-tyre price, OR **Total Amount** for the line total (price already ×qty, as most ERP exports give) and the system divides by Quantity. Do not fill both.
