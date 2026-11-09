
import express from "express";

const app = express();

app.use(express.json());

app.get("/products", (req, res) => {
  res.json({
    service: "Inventory API",
    products: ["Keyboard", "Mouse"],
    page: req.query.page || "1",
  });
});

app.post("/products", (req, res) => {
  res.status(201).json({
    message: "Product received",
    product: req.body,
  });
});

app.listen(4000, () => {
  console.log("Mock upstream running on port 4000");
});
