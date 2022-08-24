const http = require("http");
const redis = require("redis");
const redisConnectionSettings = require(process.env.REDIS_CONNECTION_PATH);


(async () => {
    const client = redis.createClient(redisConnectionSettings);

    client.on("error", err => {
        console.log("Redis connection err: " + err);
    });
    
    await client.connect();
    const server = http.createServer(async (req,res) => {
        if(req.url != "/")
        {
            return;
        }
        let count = await client.incr("PageViews");
        res.write(`Page Views: ${count}`);
        res.end();
    });
        
    server.listen((8080), () => {
        console.log("Running server");
    });
})();