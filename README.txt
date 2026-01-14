Client Test13-Look + Online.
Server fest: wss://serverfinal-9t39.onrender.com

---
✅ Persistenz "100% Restore" (Firebase Firestore, Server bleibt Chef)

Dieses Repo nutzt weiterhin den bisherigen Disk-Save als Fallback, aber wenn du Firebase aktivierst,
werden Saves/Restore dauerhaft in Firestore gespeichert (wichtig für Render/free, da Disk nach Restart leer sein kann).

Render / ENV Variablen:

1) FIREBASE_ENABLED=1
2) FIREBASE_COLLECTION=rooms   (optional)

Service Account (eine von beiden Varianten):

A) FIREBASE_SERVICE_ACCOUNT_JSON
   → kompletter JSON Inhalt (als EIN String)

oder

B) FIREBASE_SERVICE_ACCOUNT_B64
   → Base64 vom JSON Inhalt (empfohlen in Render)

Hinweis: Speichern passiert serverseitig nach jeder Aktion (move, roll, resume, place_barricade, ...)
und jeder Snapshot bekommt eine rev (Revision) im state.
