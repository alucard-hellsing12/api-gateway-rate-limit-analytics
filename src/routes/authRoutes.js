import { Router } from "express";
import { login, signup } from "../services/authService.js";
import { requiredAuth } from "../middleware/requiredAuth.js";

const router = Router();

router.post("/signup", async (req,res,next) => {
    try {
        const user =  await signup(req.body);

        res.status(201).json(user);
    } catch (error) {
        if(error.code === "P2002"){
           return res.status(409).json({
            error : "An email entry already exists"
           });
        }
        if(error.name === "ZodError"){
            return res.status(400).json({
                error : "invalid signup inputs",
                details : error.issues,
            });
        }

        next(error);
    }
});

router.post("/login",async (req,res,next) => {
    try {
        const result = await login(req.body);

        if(!result){
            return res.status(401).json({
                error : "invalid email or password",
            });
        }
        res.json(result);

    } catch (error) {
        if(error.name === "ZodError"){
            return res.status(400).json({
                error : "invalid login input",
                details : error.issues
            });
        }
        next(error);
    }
});

router.get("/me",requiredAuth,(req,res) => {
    res.json({
        message: "You are authenticated",
        userId: req.user.id,
    });
})

export default router;