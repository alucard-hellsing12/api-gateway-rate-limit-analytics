import jwt from "jsonwebtoken";

export function requiredAuth(req,res,next){
    const authHeader = req.get("Authorization");
    if(!authHeader || !authHeader.startsWith("Bearer ")){
        return res.status(401).json({
            error : "authentication token required",
        });
    }

    const token = authHeader.split(' ')[1];
    
    try{
        const payload = jwt.verify(token,process.env.JWT_SECRET);

        if(typeof payload.sub !== "string"){
            return res.status(401).json({
                error : "invalid authentication token",
            });
        }

        req.user = {
            id : payload.sub,
        };

        next();
    }
    catch(err){
        return res.status(401).json({
            error : "invalid authentication token",
        });
    }
}