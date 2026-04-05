const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

// Serve static files from the webpack build output
app.use(
  express.static(DIST, {
    setHeaders(res) {
      // Required CORS headers for Office Add-ins
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  })
);

// manifest.xml needs correct content-type for Office to accept URL-based installs
app.get("/manifest.xml", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(path.join(DIST, "manifest.xml"));
});

app.listen(PORT, () => {
  console.log(`AI:ssociate Word Plugin server running on port ${PORT}`);
});
