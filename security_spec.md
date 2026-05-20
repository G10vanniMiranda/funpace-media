# Security Specification - FunPace

## Data Invariants

1. A Product cannot exist without a valid `vendedorId` that identifies the photographer owner.
2. Orders can only be read by the buyer who placed them or by an authorized admin.
3. User profiles can only be written by the authenticated owner.
4. Photographers can only edit their own profiles and products.
5. `price` must be a positive number.
6. `status` of an order cannot be changed once it is `completed`.

## Supabase RLS Requirements

The production database must enforce Row Level Security policies for:

- `products`;
- `photographers`;
- `orders`;
- `users` or `profiles`, if used.

The frontend must not be trusted for ownership, admin permissions, price calculation, order status or payout state.

## Deny Test Cases

1. **Identity Spoofing**: Attempt to create a profile with someone else's user id.
2. **Privilege Escalation**: Attempt to set `verified: true` from the public client.
3. **Ghost Writes**: Attempt to add a field such as `isAdmin: true` to a profile.
4. **Price Manipulation**: Attempt to set `price: 0.01` on a product you do not own.
5. **Orphaned Content**: Attempt to upload a product with a non-existent `vendedorId`.
6. **Cross-User Read**: Buyer A attempts to read Buyer B's order.
7. **Cross-Photographer Edit**: Photographer A attempts to edit Photographer B's product.
8. **Invalid ID**: Attempt to use unsafe ids or path traversal values.
9. **Spam Upload**: Attempt to create oversized metadata fields.
10. **Terminal State Bypass**: Attempt to change an order from `completed` back to `pending`.
11. **Negative Price**: Attempt to create a product with a negative price.
12. **Unauthenticated Write**: Attempt to write protected tables without a Supabase Auth session.
