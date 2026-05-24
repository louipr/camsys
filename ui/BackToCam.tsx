/**
 * BackToCam — small chip that surfaces when this renderer was
 * navigated into from cam's BrowserWindow (mobile-mode navigate-
 * away). Clicking returns to cam's UI by navigating the same
 * BrowserWindow back to cam's daemon URL.
 *
 * Detection: `document.referrer.port === '5200'` (cam's daemon
 * port is fixed per ADR-010). Renders nothing in the standalone-
 * Electron case (referrer empty) so it doesn't clutter direct
 * launches.
 *
 * Shared by every CAM-launched app (audit, docskit, term,
 * camsys's own app) — previously each carried its own copy. Style
 * is fixed-positioned top-right by default; pass `style` to
 * override (e.g. when the app's own header has a custom layout).
 */
import { useEffect, useState, type CSSProperties } from 'react'

/** Default port cam's daemon binds on (per ADR-010). Exposed so
 *  callers can override for tests or alternate cam deployments. */
export const CAM_DAEMON_PORT = '5200'
export const CAM_DAEMON_URL = `http://localhost:${CAM_DAEMON_PORT}/`

function loadedInsideCam(camPort: string): boolean {
  const ref = document.referrer
  if (!ref) return false
  try {
    const u = new URL(ref)
    return u.port === camPort
  } catch { return false }
}

export interface BackToCamProps {
  /** Override cam's daemon port for detection. Default '5200'. */
  camPort?: string
  /** Override the link target. Default `http://localhost:5200/`. */
  href?: string
  /** Override / extend the chip's style. Default is fixed top-right. */
  style?: CSSProperties
  /** Override the chip label. Default '← Back to cam'. */
  label?: string
}

export function BackToCam({
  camPort = CAM_DAEMON_PORT,
  href = CAM_DAEMON_URL,
  style,
  label = '← Back to cam',
}: BackToCamProps = {}) {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(loadedInsideCam(camPort)) }, [camPort])
  if (!show) return null
  return (
    <a
      href={href}
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 9999,
        padding: '4px 10px',
        fontSize: 11,
        borderRadius: 999,
        textDecoration: 'none',
        background: 'rgba(96, 165, 250, 0.15)',
        color: '#93c5fd',
        border: '1px solid rgba(96, 165, 250, 0.3)',
        ...style,
      }}
    >
      {label}
    </a>
  )
}
