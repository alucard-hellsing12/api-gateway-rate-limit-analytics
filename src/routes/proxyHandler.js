import {Readable} from "node:stream";
import { pipeline } from "node:stream/promises";
import { getUpstreamById } from "../services/upstreamService.js";

const TIMEOUT_MS = 10_000;

const blockedHeaders = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "x-api-key",
]);

function getForwardHeaders(headers){
    const result = new Headers();

    const connectionHeader = headers.connection || "";
    const connectionTokens = connectionHeader
                                .split(",")
                                .map((val) => val.trim().toLowerCase())
                                .filter(Boolean);

    for(const [name,value] of Object.entries(headers)){
        const lowerName = name.toLowerCase();
        if(!value || blockedHeaders.has(lowerName) || connectionTokens.includes(lowerName))
            continue;

        result.set(name,(Array.isArray(value)? value.join(", ") : value));
    }

    return result;
}

export async function proxyHandler(req,res){
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        TIMEOUT_MS
    );

    try {
        //before fetching response
        const upstream = await getUpstreamById(req.params.upstreamId);

        if(!upstream){
            return res.status(404).json({
                error : "Upstream not found",
            });
        }

        const baseUrl = upstream.baseUrl.replace(/\/+$/,"");
        const targetUrl = new URL(
            `${baseUrl}/${req.url.replace(/^\/+/,"")}`
        ); 

        const headers = getForwardHeaders(req.headers);

        let body;

        if(!["GET","HEAD"].includes(req.method) && req.body !== undefined){
            if(typeof req.body === "object" && req.body !== null && !Buffer.isBuffer(req.body)){
                body = JSON.stringify(req.body);
            }
            else if(typeof req.body === "string"){
                body = req.body;
            }
            else if(Buffer.isBuffer(req.body)){
                body = req.body;
            }
        }

        const upstreamResponse = await fetch(targetUrl , {
            method : req.method,
            headers,
            body,
            signal : controller.signal,
            redirect : "manual",
        });

        res.status(upstreamResponse.status);

        upstreamResponse.headers.forEach((value,key) => {
            if(!blockedHeaders.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie"){
                res.setHeader(key,value);
            }
        });

        if(req.method === "HEAD" || [204,304].includes(upstreamResponse.status)){
           return res.end();
        }

        if(!upstreamResponse.body){
            return res.end();
        }

        if (upstreamResponse.body) {
        await pipeline(
            Readable.fromWeb(upstreamResponse.body),
            res
        );
        } else {
            res.end();
        }
    }
    catch(err){
        if(res.headersSent){
            return res.destroy(err);
        }
        
        if (err.name === "AbortError" || err.name === "TimeoutError") {
            return res.status(504).json({
                error: "Upstream request timed out",
            });
        }

        console.error("Proxy request failed:", err.message);

        return res.status(502).json({
            error: "Failed to reach upstream API",
        });
    }
    finally{
        clearTimeout(timeout);
    }
}