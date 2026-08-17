import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"https://hreinvestor.com","Access-Control-Allow-Headers":"authorization, content-type, apikey, x-client-info"};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 const token=request.headers.get("Authorization")?.replace("Bearer ",""); if(!token)return new Response(JSON.stringify({error:"Sign in required"}),{status:401,headers:cors});
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const {data:{user}}=await admin.auth.getUser(token); if(!user)return new Response(JSON.stringify({error:"Invalid session"}),{status:401,headers:cors});
 const {data:profile}=await admin.from("member_profiles").select("role,access_status").eq("id",user.id).single();
 if(!profile||profile.role!=="owner"||profile.access_status!=="approved")return new Response(JSON.stringify({error:"Owner access required"}),{status:403,headers:cors});
 const {title,template_id,placeholder_name,signer_name,signer_email,test_mode=true}=await request.json();
 if(!title||!template_id||!placeholder_name||!signer_name||!signer_email)return new Response(JSON.stringify({error:"Missing contract details"}),{status:400,headers:cors});
 const response=await fetch("https://www.signwell.com/api/v1/document_templates/documents/",{method:"POST",headers:{"X-Api-Key":Deno.env.get("SIGNWELL_API_KEY")!,"Content-Type":"application/json"},body:JSON.stringify({template_id,name:title,test_mode:Boolean(test_mode),draft:false,recipients:[{id:"1",placeholder_name,name:signer_name,email:signer_email}]})});
 const payload=await response.json(); if(!response.ok)return new Response(JSON.stringify({error:payload?.message||"SignWell could not create the document"}),{status:502,headers:cors});
 const {error}=await admin.from("esign_contracts").insert({title,template_id,signer_name,signer_email,signwell_document_id:payload.id,status:"sent",test_mode:Boolean(test_mode),created_by:user.id});
 if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
 return new Response(JSON.stringify({ok:true,document_id:payload.id}),{headers:{"Content-Type":"application/json",...cors}});
});