/**
 * CopilotKit's Inspector is on by default in development. It mounts a floating
 * launcher over the top-right of the page and adds a "View in Inspector" button
 * to the toolbar of *every* assistant message, which reads as noise once a run
 * produces a dozen of them.
 *
 * It is genuinely useful for learning the AG-UI event flow, so it stays one env
 * var away rather than being removed:
 *
 *   NEXT_PUBLIC_ENABLE_INSPECTOR=true
 *
 * Must be NEXT_PUBLIC_ — it is read in the browser.
 */
export const INSPECTOR_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_INSPECTOR === "true";
