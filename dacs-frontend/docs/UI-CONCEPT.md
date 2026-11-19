# DACS UI concept

## Product framing

DACS is a B2B data-lifecycle and data-aging control platform. The AI assistant is one part of the product, not the entire product. The workspace should help data administrators, data architects, infrastructure leads, archivists and information-security specialists manage data sources and lifecycle operations.

## Visual system

- Light grey-white application surfaces.
- Graphite typography and navigation.
- Lime accent for focus, status and primary actions.
- Restrained cards, thin borders and compact enterprise information density.
- Responsive sidebar and content layout.

## Screens

1. Overview: source/configuration counts read from Core; analytics remains unavailable until an API exists.
2. Sources: live `GET /api/sources` and `GET /api/impls`, plus `POST /api/impls` to create an implementation.
3. Login and registration: visual prototypes pending Keycloak/OAuth2 flow agreement.
4. Policies, dependencies, recommendations and archive: unavailable states until corresponding backend contracts are implemented.

## Data integrity rule

Do not populate business metrics, recommendation records, data-volume charts, organization names, source connection labels or user identity with invented values. Use Core responses, explicit demo fixtures clearly labelled as demo, or an honest empty/unavailable state.
