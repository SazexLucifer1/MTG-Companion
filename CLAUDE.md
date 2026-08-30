# Hinweise für Claude Code

- Nach Abschluss einer Aufgabe auf einem Feature-Branch **immer direkt einen Pull Request erstellen** (nicht erst nachfragen oder darauf warten, dass der User explizit danach fragt). Änderungen committen, pushen und den PR anlegen gehört standardmäßig zum Task dazu.
- Den erstellten PR danach **auch direkt selbst mergen**, sofern die CI-Checks, die für diesen Diff relevant sind, grün sind (ein bereits vorher bestehender, unabhängiger Check-Fehler blockiert das Mergen nicht). Nicht auf eine explizite Merge-Bestätigung des Users warten - Erstellen und Mergen gehören standardmäßig zusammen, damit Änderungen live gehen.
