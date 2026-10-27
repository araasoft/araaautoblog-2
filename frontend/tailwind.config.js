export default {future:{hoverOnlyWhenSupported:true},content:["./index.html","./src/**/*.{js,jsx}"],theme:{extend:{
colors:{y:"#F4D532",n:"#111835",b:"#2948C2",w:"#FBFDFC"},fontFamily:{sans:["Inter","system-ui","sans-serif"]},
keyframes:{rise:{from:{opacity:0,transform:"translateY(40px)"},to:{opacity:1,transform:"none"}},float:{to:{transform:"translate(40px,30px) scale(1.12)"}},spin:{to:{transform:"rotate(360deg)"}},shim:{to:{backgroundPosition:"-200% 0"}},pop:{from:{opacity:0,transform:"scale(.95)"},to:{opacity:1,transform:"none"}}},
animation:{rise:"rise .9s cubic-bezier(.2,.7,.2,1) both",float:"float 14s ease-in-out infinite alternate",orbit:"spin 50s linear infinite",shim:"shim 1.4s infinite",pop:"pop .35s ease both"}}}}
