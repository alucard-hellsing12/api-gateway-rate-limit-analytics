import z, { email } from "zod";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";

const signupSchema = z.object({
    email : z.email(),
    password : z.string().min(8)
});

const loginSchema = z.object({
    email : z.email(),
    password : z.string().min(1)
});

export async function signup(data){
    const input = signupSchema.parse(data);

    const hashPassword = await bcrypt.hash(input.password,10);

    return prisma.user.create({
        data : {
            email: input.email,
            password : hashPassword,
        },
        select :{
            id: true,
            email: true,
        }
    });
}

export async function login(data){
    const input = loginSchema.parse(data);

    const user = await prisma.user.findUnique({
        where : {
            email : input.email,
        }
    });

    if(!user) return null;

    const matches = await bcrypt.compare(input.password,user.password);

    if(!matches) return null;

    const token = jwt.sign({sub : user.id},process.env.JWT_SECRET,{expiresIn : process.env.JWT_EXPIRES_IN || "1h"});
    return {
        token,
        user : {
            id : user.id,
            email : user.email,
        }
    };
}