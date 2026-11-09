
local key = KEYS[1]
local capacity = tonumber(ARGV[1])

local refill_rate = capacity / 60000

local time = redis.call("TIME")

local now = (tonumber(time[1]))*1000 + math.floor((tonumber(time[2])) / 1000)

local bucket = redis.call("HMGET",key,"tokens","last_refill")

local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    last_refill = now
end

local elapsed = math.max(0,now - last_refill)

tokens = math.min(capacity,tokens + refill_rate * elapsed)

local allowed = 0
local retry_after_ms = 0

if tokens >= 1 then
    allowed = 1
    tokens = tokens - 1
else
    retry_after_ms = math.ceil((1-tokens) / refill_rate)
end

redis.call("HSET",key,"tokens",tokens,"last_refill",now)
redis.call("PEXPIRE",key,120000)

return {allowed,math.floor(tokens),retry_after_ms}