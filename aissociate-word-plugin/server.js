const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the webpack build output
app.use(
  express.static(path.join(__dirname, "dist"), {
    setHeaders(res) {
      // Required CORS headers for Office Add-ins
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  })
);

// Fallback to taskpane.html for any unknown routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "taskpane.html"));
});

app.listen(PORT, () => {
  console.log(`AI:ssociate Word Plugin server running on port ${PORT}`);
});
