# Repository reading guide

This file routes readers of this public repository; it grants no permission and does not replace the consumer runtime's instructions or user authorization.

1. Read root `CURRENT.json` first. Only its `entryPoints` and `fileChecks` describe the latest export. Validate with `node tools/verify-current.mjs` before using the references.
2. Read `current/docs/MACHINE-HANDOFF.md` and check the actual target DSH version, OS, runtime and existing settings. Source reading is allowed on any platform; applying native rc.5 patches is a separate version-bound action.
3. `archive/` is immutable historical reference, not an active source. Never recursively load archived principles, profiles, patches, manifests or CLI tools to fill gaps in the latest configuration. Use it only when the user explicitly requests historical comparison.
4. Example profiles are reference-only. Do not copy them over an existing profile, share a DSH_HOME, connect a model/provider or run an installer merely because it is mentioned. Preserve credentials, existing conversations, OAuth, plugin settings and user changes.
5. No hidden fallback between rc.5 and Desktop alpha.2. On a mismatch, report adaptation_required and use the architecture as design input; do not apply native patches until their target is independently qualified.
6. Inspect scripts as text. Do not import executable CLI modules as a discovery technique. The verifier uses Node built-ins and reads only explicit latest files; it does not run vendored tools or archive scripts.
7. Report historical validation, this checkout's static verification, actual installation, current runtime adoption and user acceptance separately. A hash proves identity, not safety or runtime success.
