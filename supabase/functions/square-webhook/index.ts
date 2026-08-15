// Square membership automation is intentionally disabled.
 // HREI member access is approved manually by the Owner.
Deno.serve(() => new Response(
  JSON.stringify({ message: "Membership billing is disabled. Access is managed by the HREI Owner." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));