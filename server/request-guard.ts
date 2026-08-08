/**
 * Local-server hardening for non-idempotent HTTP requests (0.7, §5.1 of the plan).
 *
 * The backend listens on 127.0.0.1, but browsers can still be tricked into
 * issuing cross-site POSTs to local servers. These pure predicates reject
 * request bodies that are not JSON and origins that are not the local UI.
 */

/** Whether the request's Content-Type is a JSON media type with only a charset parameter. */
export function requestContentTypeAllowed(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim())
  if (mediaType.toLowerCase() !== 'application/json') return false
  return parameters.every((parameter) => /^charset=/i.test(parameter))
}

/**
 * Whether a request may originate from the local UI. An absent Origin is
 * allowed (same-tab navigation, curl); a present Origin must resolve to
 * 127.0.0.1, localhost, or [::1] on any port, and a present Sec-Fetch-Site
 * must not be 'cross-site'.
 */
export function requestOriginAllowed(
  origin: string | undefined,
  secFetchSite: string | undefined,
): boolean {
  if (secFetchSite === 'cross-site') return false
  if (origin === undefined) return true
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}
