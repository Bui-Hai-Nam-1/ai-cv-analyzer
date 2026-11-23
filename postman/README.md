Import `AI-CV-Analyzer.postman_collection.json` into Postman.
The collection defaults to `baseUrl` = `http://localhost:8080` and
`cvServiceUrl` = `http://localhost:3001`; override them for a different setup.
The CV create and upload requests save the returned ID as `cvId`, which is used by
the get and delete requests. For "Upload CV - PDF or DOCX", select a local
PDF/DOCX file in the `file` form field.
