export function errorHandler(err,req,res,next){
    console.error(err);

    const statusCode = err.status || err.statusCode || 500;

    res.status(statusCode).json({
        error : {
            message : err.message || "internal server error"
        }
    });
}