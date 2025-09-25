const express = require("express");

const app = express();

if (process.env.NODE_ENV !== "production") {
  const testEmailRouter = require("./routes/test-email.js");
  app.use("/test-email", testEmailRouter);
}

module.exports = app;
