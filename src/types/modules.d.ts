/**
 * Bootstrap ships no bundled types for its pre-built JS bundle. It is imported
 * purely for its side effects (registering the data-bs-* behaviours), so a
 * side-effect-only declaration is the honest description — nothing in the app
 * calls into it programmatically.
 */
declare module "bootstrap/dist/js/bootstrap.bundle.min.js";
