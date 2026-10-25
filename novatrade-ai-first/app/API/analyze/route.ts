import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));const question=String(body.question||'').slice(0,4000);const symbol=String(body.symbol||'').slice(0,40);
 if(!question&&!symbol&&!body.image)return NextResponse.json({error:'Provide a question, symbol, or chart image.'},{status:400});
 if(!process.env.OPENAI_API_KEY)return NextResponse.json({ok:false,status:'setup_required',message:'AI chart/research analysis is not enabled yet. Configure OPENAI_API_KEY server-side. No forecast was fabricated.',liveExecutionEnabled:false},{status:503});
 // Deliberately no unverified forecast fallback: provider integration is gated until model-specific response handling is validated.
 return NextResponse.json({ok:false,status:'adapter_required',message:'The AI key is present, but the validated model adapter is not enabled in this build. No forecast was generated.',liveExecutionEnabled:false},{status:501});
}
