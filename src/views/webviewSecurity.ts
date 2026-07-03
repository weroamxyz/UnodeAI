import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

/** A CSP-grade nonce: cryptographically random (not Math.random), URL-safe base64. */
export function nonce(): string {
  return randomBytes(16).toString('base64').replace(/[+/=]/g, '');
}

export function csp(webview: vscode.Webview, scriptNonce?: string): string {
  const scriptSrc = scriptNonce ? `'nonce-${scriptNonce}'` : `'none'`;
  return [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${scriptSrc}`,
  ].join('; ');
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

export function sanitizeHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}
