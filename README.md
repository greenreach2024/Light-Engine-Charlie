# Light-Engine-Charlie

Light Engine Charlie

## Diagnostics

Use the connectivity helper to confirm that the HTTP listener is reachable:

```bash
node scripts/check-port.js [port] [host]
```

The script performs a lightweight TCP probe and surfaces likely causes such as
port conflicts or missing network bindings.  It is helpful when the server logs
show a successful boot but the UI is still inaccessible from a browser.
