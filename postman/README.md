Import `AI-CV-Analyzer.postman_collection.json` into Postman.
The collection defaults to the local Gateway and service URLs (`8080`, `3001`,
`3002`, and `3003`); override them for a different setup.

Create CV/JD requests save returned IDs into collection variables. The analysis
request uses those IDs and saves its own ID for the result, skill-gap, and
recommendation requests. Select a local file in the `file` field when running
the CV PDF/DOCX or JD TXT/PDF/DOCX upload requests.
