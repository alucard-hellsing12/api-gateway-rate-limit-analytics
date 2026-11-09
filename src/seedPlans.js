import prisma from "./lib/prisma.js";

async function seedPlans(){
    await prisma.plan.upsert({
        where : {name : "free"},
        update : {maxReq : 60},
        create : {
            name: "free",
            maxReq: 60
        }
    });

    await prisma.plan.upsert({
        where : {name : "pro"},
        update : {maxReq : 600},
        create : {
            name: "pro",
            maxReq: 600
        }
    });

    console.log("plans configured successfully");
}

try {
    await seedPlans();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
finally{
    await prisma.$disconnect();
}