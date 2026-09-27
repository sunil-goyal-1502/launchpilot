# Insights recommendation size-limit investigation

The production evidence snapshot is `b12bc42edcb309385397768ae7d18ec1f1cd7c7553d22da6df3d2095090ed094`, from Insights commit `1724902e3b971592a013d5d75ebe282b6c08ddc3`.

The diagram selected 38 production declarations/references. The recommendation scope intentionally also contained 96 source-code observations, giving 134 observations, 754 configuration bindings and 341 findings. Its original aliased JSON request contained 451,957 characters, exceeding the planner's hard-coded 260,000-character guard. The error occurred before contacting Catalyst/Compass. The earlier diagram verification had not exercised this complete recommendation flow.

The repaired planner retains that complete scope. It uses reversible evidence tables and string references, creates a shared design, then reviews configuration in batches of at most 80 bindings with three concurrent requests. The shared-design packet is 222,563 characters. Oversized configuration batches split further; missing entries receive supplemental reviews. The final combined result must account for every original observation, binding and finding.

Schema enum corrections are restricted to the exact invalid fields and allowed values. Citations are attached from explicitly selected resource/binding IDs; unknown evidence and unsupported repository connections still fail validation. The API caches only the complete validated plan, keyed by snapshot, scope, model/provider/gateway and planner version. Explicit regeneration bypasses that cache.

Live Compass verification completed using the configured `gpt-5.5` route. Plan `54917e74e5ca509e7955c589860be692b72fef085c6370f469ce3bb55897c28f` has 28 target components and 655 configuration-delivery entries covering all 754 individual bindings, with all 134 observations and 341 findings accounted for. The shared design and ten configuration batches were validated together. No infrastructure was deployed in this verification.
