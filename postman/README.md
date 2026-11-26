Import `AI-CV-Analyzer.postman_collection.json` into Postman.
The collection defaults to the local Gateway and service URLs (`8080`, `3001`,
`3002`, and `3003`); override them for a different setup.

Create CV/JD requests save returned IDs into collection variables. The analysis
request uses those IDs and saves its own ID for the result, skill-gap, and
recommendation requests. Select a local file in the `file` field when running
the CV PDF/DOCX or JD TXT/PDF/DOCX upload requests.

The collection has sample files in `fixtures/`. In Postman Desktop, set the
Postman working directory to this `postman` folder or reselect
`fixtures/sample-cv.docx` and `fixtures/sample-jd.txt` in the upload requests.
The collection creates and deletes its CV/JD test records; completed analysis
records are retained.

To run the same collection from PowerShell with Newman:

```powershell
npx --yes newman run postman\AI-CV-Analyzer.postman_collection.json `
  --working-dir postman --reporters cli `
  --timeout-request 200000 --timeout 400000
```
