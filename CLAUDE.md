# Hinweise für Claude Code

- Nach Abschluss einer Aufgabe auf einem Feature-Branch **immer direkt einen Pull Request erstellen** (nicht erst nachfragen oder darauf warten, dass der User explizit danach fragt). Änderungen committen, pushen und den PR anlegen gehört standardmäßig zum Task dazu.
- **PRs NICHT mehr automatisch mergen.** Der User möchte Änderungen erst separat testen (z. B. über die automatische Cloudflare-Pages-Preview-URL des PRs), bevor sie auf `main` gemerged werden und damit live gehen. Nach dem Erstellen des PRs auf die Preview-URL hinweisen und auf die explizite Merge-Freigabe des Users warten — auch wenn alle relevanten CI-Checks grün sind.
