const errors=[];
const required=["APP_URL","MONGODB_URI","DATA_ENCRYPTION_KEY","SEARCH_HMAC_KEY"];
for(const key of required)if(!process.env[key])errors.push(`${key} is missing.`);
for(const key of ["DATA_ENCRYPTION_KEY","SEARCH_HMAC_KEY"])if(process.env[key]&&Buffer.from(process.env[key],"base64").length!==32)errors.push(`${key} must decode to 32 bytes.`);
if(process.env.DATA_ENCRYPTION_KEY&&process.env.DATA_ENCRYPTION_KEY===process.env.SEARCH_HMAC_KEY)errors.push("The encryption and search keys must be different.");
if(process.env.APP_URL){try{const url=new URL(process.env.APP_URL);if(process.env.NODE_ENV==="production"&&url.protocol!=="https:")errors.push("Production APP_URL must use HTTPS.");if(url.pathname!=="/")errors.push("APP_URL must be the deployment origin, not a subpath.");}catch{errors.push("APP_URL is not a valid URL.");}}
if(process.env.S3_BUCKET&&(!process.env.FILE_SCAN_SECRET||process.env.FILE_SCAN_SECRET.length<32))errors.push("S3 uploads require a scanner secret of at least 32 characters.");
if(process.env.NODE_ENV==="production"&&process.env.REQUIRE_PRIVILEGED_MFA!=="true")errors.push("Production requires REQUIRE_PRIVILEGED_MFA=true.");
if(errors.length){for(const error of errors)console.error(error);process.exitCode=1;}
else{console.log("Environment format checks passed. Database, realtime and storage connectivity have NOT been tested by this command.");}
