#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define SCHEMA_VERSION "yutu-graph@1"
#define GRAPH_VERSION "1.0.0"
#define MAX_INPUT_BYTES 1048576UL
#define MAX_MANIFEST_BYTES 1048576UL
#define MAX_MEMORY_BYTES 8388608UL
#define MAX_NODES 128
#define MAX_EDGES 256
#define MAX_EVENTS 256
#define MAX_REVISIONS 3
#define REVIEW_TIMEOUT_MS 5000
#define REVIEW_POLL_MS 500
#define ID_LEN 96
#define TEXT_LEN 256
#define CONDITION_LEN 512

typedef struct {
  char code[64];
  char detail[512];
} Error;

static size_t tracked_current = 0;
static size_t tracked_peak = 0;

static void set_error(Error *err, const char *code, const char *fmt, ...) {
  va_list ap;
  if (err == NULL) return;
  snprintf(err->code, sizeof(err->code), "%s", code == NULL ? "unknown_error" : code);
  va_start(ap, fmt);
  vsnprintf(err->detail, sizeof(err->detail), fmt, ap);
  va_end(ap);
}

static void *tracked_malloc(size_t size, Error *err) {
  size_t *raw;
  if (size == 0) size = 1;
  if (size > MAX_MEMORY_BYTES || tracked_current > MAX_MEMORY_BYTES - size) {
    set_error(err, "memory_limit_exceeded", "tracked allocation would exceed %lu bytes", (unsigned long)MAX_MEMORY_BYTES);
    return NULL;
  }
  raw = (size_t *)malloc(sizeof(size_t) + size);
  if (raw == NULL) {
    set_error(err, "allocation_failed", "malloc(%lu) failed", (unsigned long)size);
    return NULL;
  }
  raw[0] = size;
  tracked_current += size;
  if (tracked_current > tracked_peak) tracked_peak = tracked_current;
  return (void *)(raw + 1);
}

static void tracked_free(void *ptr) {
  size_t *raw;
  if (ptr == NULL) return;
  raw = ((size_t *)ptr) - 1;
  if (tracked_current >= raw[0]) tracked_current -= raw[0];
  free(raw);
}

/* Compact SHA-256 implementation written for this GE-01 binary. */
typedef struct {
  uint8_t data[64];
  uint32_t datalen;
  uint64_t bitlen;
  uint32_t state[8];
} Sha256Ctx;

static const uint32_t sha_k[64] = {
  0x428a2f98U,0x71374491U,0xb5c0fbcfU,0xe9b5dba5U,0x3956c25bU,0x59f111f1U,0x923f82a4U,0xab1c5ed5U,
  0xd807aa98U,0x12835b01U,0x243185beU,0x550c7dc3U,0x72be5d74U,0x80deb1feU,0x9bdc06a7U,0xc19bf174U,
  0xe49b69c1U,0xefbe4786U,0x0fc19dc6U,0x240ca1ccU,0x2de92c6fU,0x4a7484aaU,0x5cb0a9dcU,0x76f988daU,
  0x983e5152U,0xa831c66dU,0xb00327c8U,0xbf597fc7U,0xc6e00bf3U,0xd5a79147U,0x06ca6351U,0x14292967U,
  0x27b70a85U,0x2e1b2138U,0x4d2c6dfcU,0x53380d13U,0x650a7354U,0x766a0abbU,0x81c2c92eU,0x92722c85U,
  0xa2bfe8a1U,0xa81a664bU,0xc24b8b70U,0xc76c51a3U,0xd192e819U,0xd6990624U,0xf40e3585U,0x106aa070U,
  0x19a4c116U,0x1e376c08U,0x2748774cU,0x34b0bcb5U,0x391c0cb3U,0x4ed8aa4aU,0x5b9cca4fU,0x682e6ff3U,
  0x748f82eeU,0x78a5636fU,0x84c87814U,0x8cc70208U,0x90befffaU,0xa4506cebU,0xbef9a3f7U,0xc67178f2U
};

static uint32_t rotr32(uint32_t a, uint32_t b) { return (a >> b) | (a << (32U - b)); }

static void sha256_transform(Sha256Ctx *ctx, const uint8_t data[64]) {
  uint32_t a,b,c,d,e,f,g,h,i,j,t1,t2,m[64];
  for (i=0,j=0; i<16; i++,j+=4) m[i]=((uint32_t)data[j]<<24)|((uint32_t)data[j+1]<<16)|((uint32_t)data[j+2]<<8)|data[j+3];
  for (; i<64; i++) {
    uint32_t s0=rotr32(m[i-15],7)^rotr32(m[i-15],18)^(m[i-15]>>3);
    uint32_t s1=rotr32(m[i-2],17)^rotr32(m[i-2],19)^(m[i-2]>>10);
    m[i]=m[i-16]+s0+m[i-7]+s1;
  }
  a=ctx->state[0]; b=ctx->state[1]; c=ctx->state[2]; d=ctx->state[3];
  e=ctx->state[4]; f=ctx->state[5]; g=ctx->state[6]; h=ctx->state[7];
  for (i=0; i<64; i++) {
    uint32_t s1=rotr32(e,6)^rotr32(e,11)^rotr32(e,25);
    uint32_t ch=(e&f)^((~e)&g);
    uint32_t s0=rotr32(a,2)^rotr32(a,13)^rotr32(a,22);
    uint32_t maj=(a&b)^(a&c)^(b&c);
    t1=h+s1+ch+sha_k[i]+m[i]; t2=s0+maj;
    h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
  }
  ctx->state[0]+=a; ctx->state[1]+=b; ctx->state[2]+=c; ctx->state[3]+=d;
  ctx->state[4]+=e; ctx->state[5]+=f; ctx->state[6]+=g; ctx->state[7]+=h;
}

static void sha256_init(Sha256Ctx *ctx) {
  ctx->datalen=0; ctx->bitlen=0;
  ctx->state[0]=0x6a09e667U; ctx->state[1]=0xbb67ae85U; ctx->state[2]=0x3c6ef372U; ctx->state[3]=0xa54ff53aU;
  ctx->state[4]=0x510e527fU; ctx->state[5]=0x9b05688cU; ctx->state[6]=0x1f83d9abU; ctx->state[7]=0x5be0cd19U;
}

static void sha256_update(Sha256Ctx *ctx, const uint8_t *data, size_t len) {
  size_t i;
  for (i=0; i<len; i++) {
    ctx->data[ctx->datalen++]=data[i];
    if (ctx->datalen==64) { sha256_transform(ctx,ctx->data); ctx->bitlen+=512; ctx->datalen=0; }
  }
}

static void sha256_final(Sha256Ctx *ctx, uint8_t hash[32]) {
  uint32_t i=ctx->datalen;
  ctx->data[i++]=0x80;
  if (i>56) { while(i<64) ctx->data[i++]=0; sha256_transform(ctx,ctx->data); i=0; }
  while(i<56) ctx->data[i++]=0;
  ctx->bitlen+=(uint64_t)ctx->datalen*8U;
  ctx->data[63]=(uint8_t)ctx->bitlen; ctx->data[62]=(uint8_t)(ctx->bitlen>>8); ctx->data[61]=(uint8_t)(ctx->bitlen>>16); ctx->data[60]=(uint8_t)(ctx->bitlen>>24);
  ctx->data[59]=(uint8_t)(ctx->bitlen>>32); ctx->data[58]=(uint8_t)(ctx->bitlen>>40); ctx->data[57]=(uint8_t)(ctx->bitlen>>48); ctx->data[56]=(uint8_t)(ctx->bitlen>>56);
  sha256_transform(ctx,ctx->data);
  for (i=0; i<4; i++) {
    hash[i]=(uint8_t)(ctx->state[0]>>(24U-i*8U)); hash[i+4]=(uint8_t)(ctx->state[1]>>(24U-i*8U));
    hash[i+8]=(uint8_t)(ctx->state[2]>>(24U-i*8U)); hash[i+12]=(uint8_t)(ctx->state[3]>>(24U-i*8U));
    hash[i+16]=(uint8_t)(ctx->state[4]>>(24U-i*8U)); hash[i+20]=(uint8_t)(ctx->state[5]>>(24U-i*8U));
    hash[i+24]=(uint8_t)(ctx->state[6]>>(24U-i*8U)); hash[i+28]=(uint8_t)(ctx->state[7]>>(24U-i*8U));
  }
}

static void sha256_hex(const void *data, size_t len, char out[65]) {
  static const char hex[]="0123456789abcdef";
  Sha256Ctx ctx; uint8_t digest[32]; size_t i;
  sha256_init(&ctx); sha256_update(&ctx,(const uint8_t *)data,len); sha256_final(&ctx,digest);
  for(i=0;i<32;i++){out[i*2]=hex[digest[i]>>4];out[i*2+1]=hex[digest[i]&15U];} out[64]='\0';
}

static int is_sha256(const char *s) {
  size_t i;
  if (s == NULL || strlen(s) != 64) return 0;
  for (i=0;i<64;i++) if (!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f'))) return 0;
  return 1;
}

static char *read_file_limited(const char *path, size_t limit, size_t *len_out, Error *err) {
  FILE *fp; long size; char *buf; size_t got;
  fp=fopen(path,"rb");
  if(fp==NULL){set_error(err,"read_failed","cannot open %s: %s",path,strerror(errno));return NULL;}
  if(fseek(fp,0,SEEK_END)!=0||(size=ftell(fp))<0){fclose(fp);set_error(err,"read_failed","cannot size %s",path);return NULL;}
  if((size_t)size>limit){fclose(fp);set_error(err,"input_too_large","%s is %ld bytes; limit=%lu",path,size,(unsigned long)limit);return NULL;}
  rewind(fp); buf=(char *)tracked_malloc((size_t)size+1,err); if(buf==NULL){fclose(fp);return NULL;}
  got=fread(buf,1,(size_t)size,fp); fclose(fp);
  if(got!=(size_t)size){tracked_free(buf);set_error(err,"read_failed","short read for %s",path);return NULL;}
  buf[got]='\0'; if(len_out!=NULL)*len_out=got; return buf;
}

typedef struct { char *data; size_t len; size_t cap; int failed; } Buffer;

static void buf_init(Buffer *b, char *storage, size_t cap) { b->data=storage; b->len=0; b->cap=cap; b->failed=0; if(cap)b->data[0]='\0'; }

static void buf_add(Buffer *b, const char *fmt, ...) {
  va_list ap; int n;
  if(b->failed||b->len>=b->cap)return;
  va_start(ap,fmt); n=vsnprintf(b->data+b->len,b->cap-b->len,fmt,ap); va_end(ap);
  if(n<0||(size_t)n>=b->cap-b->len){b->failed=1;return;} b->len+=(size_t)n;
}

static void buf_write(Buffer *b,const char *data,size_t len) {
  if(b->failed)return;
  if(len>=b->cap-b->len){b->failed=1;return;}
  memcpy(b->data+b->len,data,len);b->len+=len;b->data[b->len]='\0';
}

static void buf_char(Buffer *b,char value) { buf_write(b,&value,1); }

static void buf_json_string(Buffer *b, const char *s) {
  const unsigned char *p=(const unsigned char *)(s==NULL?"":s); buf_char(b,'\"');
  while(*p&&!b->failed){
    if(*p=='\"'||*p=='\\'){buf_char(b,'\\');buf_char(b,(char)*p);}
    else if(*p=='\n')buf_write(b,"\\n",2); else if(*p=='\r')buf_write(b,"\\r",2); else if(*p=='\t')buf_write(b,"\\t",2);
    else if(*p<0x20)buf_add(b,"\\u%04x",(unsigned)*p); else buf_char(b,(char)*p); p++;
  } buf_char(b,'\"');
}

typedef struct { char id[ID_LEN+1]; char type[32]; char role[ID_LEN+1]; long timeout_ms; } Node;
typedef struct { char from[ID_LEN+1]; char to[ID_LEN+1]; char when[CONDITION_LEN+1]; char reason[ID_LEN+1]; char delivery[16]; } Edge;
typedef struct {
  char schema[32],graph_id[ID_LEN+1],graph_version[32],project_id[ID_LEN+1],objective_ref[TEXT_LEN+1],source_sha[65],start_node[ID_LEN+1],manifest_hash[65];
  Node nodes[MAX_NODES]; size_t node_count;
  Edge edges[MAX_EDGES]; size_t edge_count;
  long max_loops,wall_timeout_ms,max_input_bytes,max_manifest_bytes,max_memory_bytes;
  int acceptance_required,shadow_only,default_enabled;
  char on_no_edge[ID_LEN+1];
} Manifest;

static void manifest_init(Manifest *m) {
  memset(m,0,sizeof(*m)); snprintf(m->schema,sizeof(m->schema),"%s",SCHEMA_VERSION); snprintf(m->graph_version,sizeof(m->graph_version),"%s",GRAPH_VERSION);
  snprintf(m->project_id,sizeof(m->project_id),"控制台"); snprintf(m->objective_ref,sizeof(m->objective_ref),"artifact://shared/routing/flows/review-loop.yaml");
  m->max_loops=3; m->wall_timeout_ms=7200000; m->max_input_bytes=(long)MAX_INPUT_BYTES; m->max_manifest_bytes=(long)MAX_MANIFEST_BYTES; m->max_memory_bytes=(long)MAX_MEMORY_BYTES;
  m->acceptance_required=1; m->shadow_only=1; m->default_enabled=0; snprintf(m->on_no_edge,sizeof(m->on_no_edge),"fail_closed");
}

static char *trim(char *s) {
  char *end; while(*s&&isspace((unsigned char)*s))s++; end=s+strlen(s); while(end>s&&isspace((unsigned char)end[-1]))end--; *end='\0'; return s;
}

static void strip_comment(char *s) {
  char quote=0; int depth=0; size_t i;
  for(i=0;s[i];i++){
    char c=s[i]; if(quote){if(c==quote&&s[i?i-1:0]!='\\')quote=0;continue;}
    if(c=='\''||c=='\"'){quote=c;continue;} if(c=='{'||c=='[')depth++; else if(c=='}'||c==']')depth--;
    else if(c=='#'&&depth==0&&(i==0||isspace((unsigned char)s[i-1]))){s[i]='\0';break;}
  }
}

static void unquote_copy(const char *src, char *dst, size_t cap) {
  size_t n; const char *s=src; while(*s&&isspace((unsigned char)*s))s++; n=strlen(s); while(n&&isspace((unsigned char)s[n-1]))n--;
  if(n>=2&&((s[0]=='\"'&&s[n-1]=='\"')||(s[0]=='\''&&s[n-1]=='\''))){s++;n-=2;}
  if(n>=cap)n=cap-1; memcpy(dst,s,n);dst[n]='\0';
}

static int inline_get(const char *line, const char *wanted, char *out, size_t cap) {
  const char *p=strchr(line,'{'); char segment[2048];
  if(p==NULL)return 0; p++;
  while(*p&&*p!='}'){
    size_t n=0,i; char quote=0; const char *colon=NULL; char key[128];
    while(*p&&isspace((unsigned char)*p))p++;
    while(*p&&n+1<sizeof(segment)){
      char c=*p; if(quote){segment[n++]=c;if(c==quote&&p>line&&p[-1]!='\\')quote=0;p++;continue;}
      if(c=='\''||c=='\"'){quote=c;segment[n++]=c;p++;continue;} if(c==','||c=='}')break; segment[n++]=c;p++;
    }
    segment[n]='\0';
    for(i=0;i<n;i++)if(segment[i]==':'){colon=segment+i;break;}
    if(colon!=NULL){size_t klen=(size_t)(colon-segment);if(klen>=sizeof(key))klen=sizeof(key)-1;memcpy(key,segment,klen);key[klen]='\0';
      if(strcmp(trim(key),wanted)==0){unquote_copy(colon+1,out,cap);return 1;}}
    if(*p==',')p++; else if(*p=='}')break;
  } return 0;
}

static int node_cmp(const void *a,const void *b){return strcmp(((const Node *)a)->id,((const Node *)b)->id);}
static int edge_cmp(const void *a,const void *b){const Edge *x=(const Edge *)a,*y=(const Edge *)b;int c=strcmp(x->from,y->from);if(c)return c;c=strcmp(x->to,y->to);if(c)return c;c=strcmp(x->when,y->when);if(c)return c;return strcmp(x->reason,y->reason);}

static int compile_yaml_mutable(char *copy,const char *source,size_t source_len,Manifest *m,Error *err) {
  char *save=NULL,*line; enum {SEC_NONE,SEC_GUARDS,SEC_NODES,SEC_EDGES,SEC_ACCEPTANCE} section=SEC_NONE;
  manifest_init(m); sha256_hex(source,source_len,m->source_sha);
  line=strtok_r(copy,"\n",&save);
  while(line!=NULL){
    size_t indent=0; char *t,*colon; while(line[indent]==' ')indent++; strip_comment(line); t=trim(line); if(*t=='\0'){line=strtok_r(NULL,"\n",&save);continue;}
    if(indent==0){
      if(strcmp(t,"guards:")==0)section=SEC_GUARDS; else if(strcmp(t,"nodes:")==0)section=SEC_NODES; else if(strcmp(t,"edges:")==0)section=SEC_EDGES; else if(strcmp(t,"acceptance:")==0)section=SEC_ACCEPTANCE;
      else { section=SEC_NONE; colon=strchr(t,':'); if(colon!=NULL){*colon='\0';
        if(strcmp(trim(t),"id")==0)unquote_copy(colon+1,m->graph_id,sizeof(m->graph_id));
        else if(strcmp(trim(t),"on_no_edge")==0)unquote_copy(colon+1,m->on_no_edge,sizeof(m->on_no_edge));}}
    } else if(section==SEC_NODES&&t[0]=='-'){
      Node *n; char tmp[CONDITION_LEN+1]; if(m->node_count>=MAX_NODES){set_error(err,"node_limit_exceeded","more than %d nodes",MAX_NODES);return 0;}
      n=&m->nodes[m->node_count];memset(n,0,sizeof(*n));
      if(!inline_get(t,"id",n->id,sizeof(n->id))){set_error(err,"node_missing_id","node %lu has no id",(unsigned long)m->node_count);return 0;}
      if(inline_get(t,"type",n->type,sizeof(n->type))==0)snprintf(n->type,sizeof(n->type),"agent");
      inline_get(t,"agent_role",n->role,sizeof(n->role)); if(inline_get(t,"timeout_ms",tmp,sizeof(tmp)))n->timeout_ms=strtol(tmp,NULL,10); m->node_count++;
    } else if(section==SEC_EDGES&&t[0]=='-'){
      Edge *e; if(m->edge_count>=MAX_EDGES){set_error(err,"edge_limit_exceeded","more than %d edges",MAX_EDGES);return 0;}
      e=&m->edges[m->edge_count];memset(e,0,sizeof(*e));
      if(!inline_get(t,"from",e->from,sizeof(e->from))||!inline_get(t,"to",e->to,sizeof(e->to))){set_error(err,"edge_missing_endpoint","edge %lu missing from/to",(unsigned long)m->edge_count);return 0;}
      inline_get(t,"when",e->when,sizeof(e->when)); if(!inline_get(t,"reason_code",e->reason,sizeof(e->reason)))snprintf(e->reason,sizeof(e->reason),"flow_route");
      if(!inline_get(t,"delivery",e->delivery,sizeof(e->delivery)))snprintf(e->delivery,sizeof(e->delivery),"single"); m->edge_count++;
    } else if((section==SEC_GUARDS||section==SEC_ACCEPTANCE)&&(colon=strchr(t,':'))!=NULL){
      char key[128],val[128];size_t klen=(size_t)(colon-t);if(klen>=sizeof(key))klen=sizeof(key)-1;memcpy(key,t,klen);key[klen]='\0';unquote_copy(colon+1,val,sizeof(val));
      if(section==SEC_GUARDS&&strcmp(trim(key),"max_loops")==0)m->max_loops=strtol(val,NULL,10);
      else if(section==SEC_GUARDS&&strcmp(trim(key),"wall_timeout_sec")==0)m->wall_timeout_ms=strtol(val,NULL,10)*1000;
      else if(section==SEC_ACCEPTANCE&&strcmp(trim(key),"require_evidence")==0)m->acceptance_required=strcmp(val,"true")==0;
    }
    line=strtok_r(NULL,"\n",&save);
  }
  if(m->graph_id[0]=='\0'){set_error(err,"missing_graph_id","flow id is required");return 0;}
  if(m->node_count>0)snprintf(m->start_node,sizeof(m->start_node),"%s",m->nodes[0].id);
  qsort(m->nodes,m->node_count,sizeof(Node),node_cmp);qsort(m->edges,m->edge_count,sizeof(Edge),edge_cmp);return 1;
}

typedef enum {TK_END,TK_IDENT,TK_NUMBER,TK_STRING,TK_AND,TK_OR,TK_EQ,TK_NE,TK_LT,TK_LE,TK_GT,TK_GE,TK_LP,TK_RP,TK_BAD} TokenType;
typedef struct { const char *s; size_t pos,len; TokenType type; } Lexer;

static void lex_next(Lexer *l) {
  const char *s=l->s;size_t p=l->pos,start;while(s[p]&&isspace((unsigned char)s[p]))p++;l->len=0;
  if(!s[p]){l->type=TK_END;l->pos=p;return;} start=p;
  if(isalpha((unsigned char)s[p])||s[p]=='_'){p++;while(isalnum((unsigned char)s[p])||s[p]=='_'||s[p]=='.')p++;l->len=p-start;l->pos=p;
    if(l->len==3&&strncmp(s+start,"and",3)==0)l->type=TK_AND;else if(l->len==2&&strncmp(s+start,"or",2)==0)l->type=TK_OR;else l->type=TK_IDENT;return;}
  if(isdigit((unsigned char)s[p])){p++;while(isdigit((unsigned char)s[p]))p++;l->type=TK_NUMBER;l->len=p-start;l->pos=p;return;}
  if(s[p]=='\''||s[p]=='\"'){char q=s[p++];while(s[p]&&s[p]!=q){if(s[p]=='\\'&&s[p+1])p+=2;else p++;}if(s[p]!=q){l->type=TK_BAD;l->pos=p;return;}p++;l->type=TK_STRING;l->len=p-start;l->pos=p;return;}
  if(s[p]=='('){l->type=TK_LP;l->pos=p+1;return;}if(s[p]==')'){l->type=TK_RP;l->pos=p+1;return;}
  if(s[p]=='='&&s[p+1]=='='){l->type=TK_EQ;l->pos=p+2;return;}if(s[p]=='!'&&s[p+1]=='='){l->type=TK_NE;l->pos=p+2;return;}
  if(s[p]=='<'&&s[p+1]=='='){l->type=TK_LE;l->pos=p+2;return;}if(s[p]=='>'&&s[p+1]=='='){l->type=TK_GE;l->pos=p+2;return;}
  if(s[p]=='<'){l->type=TK_LT;l->pos=p+1;return;}if(s[p]=='>'){l->type=TK_GT;l->pos=p+1;return;}l->type=TK_BAD;l->pos=p+1;
}

static int parse_expr(Lexer *l);
static int parse_primary(Lexer *l){if(l->type==TK_IDENT||l->type==TK_NUMBER||l->type==TK_STRING){lex_next(l);return 1;}if(l->type==TK_LP){lex_next(l);if(!parse_expr(l)||l->type!=TK_RP)return 0;lex_next(l);return 1;}return 0;}
static int parse_cmp(Lexer *l){TokenType t;if(!parse_primary(l))return 0;t=l->type;if(t==TK_EQ||t==TK_NE||t==TK_LT||t==TK_LE||t==TK_GT||t==TK_GE){lex_next(l);return parse_primary(l);}return 1;}
static int parse_and(Lexer *l){if(!parse_cmp(l))return 0;while(l->type==TK_AND){lex_next(l);if(!parse_cmp(l))return 0;}return 1;}
static int parse_expr(Lexer *l){if(!parse_and(l))return 0;while(l->type==TK_OR){lex_next(l);if(!parse_and(l))return 0;}return 1;}

static int valid_condition(const char *condition) {
  char cleaned[CONDITION_LEN+1];size_t len;Lexer l;
  if(condition==NULL||condition[0]=='\0')return 1;snprintf(cleaned,sizeof(cleaned),"%s",condition);len=strlen(cleaned);
  if(len>=4&&cleaned[0]=='{'&&cleaned[1]=='{'&&cleaned[len-2]=='}'&&cleaned[len-1]=='}'){cleaned[len-2]='\0';memmove(cleaned,cleaned+2,len-1);}
  l.s=cleaned;l.pos=0;l.len=0;lex_next(&l);return parse_expr(&l)&&l.type==TK_END;
}

static int known_type(const char *type){static const char *types[]={"agent","tool","script","router","human_gate","end","fanout","join","subgraph"};size_t i;for(i=0;i<sizeof(types)/sizeof(types[0]);i++)if(strcmp(type,types[i])==0)return 1;return 0;}
static int unsupported_type(const char *type){return strcmp(type,"fanout")==0||strcmp(type,"join")==0||strcmp(type,"subgraph")==0;}
static int find_node(const Manifest *m,const char *id){size_t i;for(i=0;i<m->node_count;i++)if(strcmp(m->nodes[i].id,id)==0)return (int)i;return -1;}

static int validate_manifest(const Manifest *m,Error *err) {
  size_t i,j;int end_count=0,start;int seen[MAX_NODES]={0},queue[MAX_NODES],head=0,tail=0;
  if(strcmp(m->schema,SCHEMA_VERSION)!=0){set_error(err,"schema_version_mismatch","expected %s",SCHEMA_VERSION);return 0;}
  if(m->graph_id[0]=='\0'||m->graph_version[0]=='\0'||m->project_id[0]=='\0'||m->objective_ref[0]=='\0'||m->start_node[0]=='\0'){set_error(err,"missing_identity","graph identity and startNode are required");return 0;}
  if(!is_sha256(m->source_sha)){set_error(err,"invalid_source_hash","sourceSha256 must be lowercase SHA-256");return 0;}
  if(m->node_count==0||m->node_count>MAX_NODES){set_error(err,"invalid_node_count","node count=%lu",(unsigned long)m->node_count);return 0;}
  if(m->edge_count==0||m->edge_count>MAX_EDGES){set_error(err,"invalid_edge_count","edge count=%lu",(unsigned long)m->edge_count);return 0;}
  for(i=0;i<m->node_count;i++){
    if(m->nodes[i].id[0]=='\0'){set_error(err,"node_missing_id","node %lu",(unsigned long)i);return 0;}
    for(j=i+1;j<m->node_count;j++)if(strcmp(m->nodes[i].id,m->nodes[j].id)==0){set_error(err,"duplicate_node","duplicate node %s",m->nodes[i].id);return 0;}
    if(!known_type(m->nodes[i].type)){set_error(err,"unknown_node_type","node %s type=%s",m->nodes[i].id,m->nodes[i].type);return 0;}
    if(unsupported_type(m->nodes[i].type)){set_error(err,"unsupported_in_ge01","node %s type=%s",m->nodes[i].id,m->nodes[i].type);return 0;}
    if(strcmp(m->nodes[i].type,"end")==0)end_count++;
  }
  if(end_count==0){set_error(err,"missing_terminal","manifest has no end node");return 0;}
  start=find_node(m,m->start_node);if(start<0){set_error(err,"invalid_start_node","startNode %s is undefined",m->start_node);return 0;}
  for(i=0;i<m->edge_count;i++){
    if(find_node(m,m->edges[i].from)<0||find_node(m,m->edges[i].to)<0){set_error(err,"dangling_edge","edge %s->%s references undefined node",m->edges[i].from,m->edges[i].to);return 0;}
    if(!valid_condition(m->edges[i].when)){set_error(err,"invalid_condition","edge %s->%s has invalid condition",m->edges[i].from,m->edges[i].to);return 0;}
    if(strcmp(m->edges[i].delivery,"single")!=0){set_error(err,"unsupported_in_ge01","edge %s->%s delivery=%s",m->edges[i].from,m->edges[i].to,m->edges[i].delivery);return 0;}
  }
  seen[start]=1;queue[tail++]=start;while(head<tail){int cur=queue[head++];for(i=0;i<m->edge_count;i++)if(strcmp(m->edges[i].from,m->nodes[cur].id)==0){int nx=find_node(m,m->edges[i].to);if(nx>=0&&!seen[nx]){seen[nx]=1;queue[tail++]=nx;}}}
  for(i=0;i<m->node_count;i++)if(!seen[i]){set_error(err,"unreachable_node","node %s is unreachable from %s",m->nodes[i].id,m->start_node);return 0;}
  if(m->max_loops<1||m->max_loops>3||m->wall_timeout_ms<1||m->max_input_bytes!=(long)MAX_INPUT_BYTES||m->max_manifest_bytes!=(long)MAX_MANIFEST_BYTES||m->max_memory_bytes!=(long)MAX_MEMORY_BYTES){set_error(err,"invalid_budget","GE-01 resource budget mismatch");return 0;}
  if(!m->shadow_only||m->default_enabled){set_error(err,"production_semantics_forbidden","GE-01 must be shadowOnly=true/defaultEnabled=false");return 0;}
  return 1;
}

static int serialize_manifest(const Manifest *m,int include_hash,char *out,size_t cap,size_t *len_out) {
  Buffer b;size_t i;buf_init(&b,out,cap);
  buf_add(&b,"{\"schemaVersion\":");buf_json_string(&b,m->schema);buf_add(&b,",\"graphId\":");buf_json_string(&b,m->graph_id);
  buf_add(&b,",\"graphVersion\":");buf_json_string(&b,m->graph_version);buf_add(&b,",\"projectId\":");buf_json_string(&b,m->project_id);
  buf_add(&b,",\"objectiveRef\":");buf_json_string(&b,m->objective_ref);buf_add(&b,",\"sourceSha256\":");buf_json_string(&b,m->source_sha);
  buf_add(&b,",\"startNode\":");buf_json_string(&b,m->start_node);buf_add(&b,",\"nodes\":[");
  for(i=0;i<m->node_count;i++){if(i)buf_add(&b,",");buf_add(&b,"{\"id\":");buf_json_string(&b,m->nodes[i].id);buf_add(&b,",\"type\":");buf_json_string(&b,m->nodes[i].type);buf_add(&b,",\"agentRole\":");buf_json_string(&b,m->nodes[i].role);buf_add(&b,",\"timeoutMs\":%ld}",m->nodes[i].timeout_ms);}
  buf_add(&b,"],\"edges\":[");for(i=0;i<m->edge_count;i++){if(i)buf_add(&b,",");buf_add(&b,"{\"from\":");buf_json_string(&b,m->edges[i].from);buf_add(&b,",\"to\":");buf_json_string(&b,m->edges[i].to);buf_add(&b,",\"when\":");buf_json_string(&b,m->edges[i].when);buf_add(&b,",\"reasonCode\":");buf_json_string(&b,m->edges[i].reason);buf_add(&b,",\"delivery\":");buf_json_string(&b,m->edges[i].delivery);buf_add(&b,"}");}
  buf_add(&b,"],\"budgets\":{\"maxLoops\":%ld,\"wallTimeoutMs\":%ld,\"maxInputBytes\":%ld,\"maxManifestBytes\":%ld,\"maxMemoryBytes\":%ld}",m->max_loops,m->wall_timeout_ms,m->max_input_bytes,m->max_manifest_bytes,m->max_memory_bytes);
  buf_add(&b,",\"policies\":{\"acceptanceRequired\":%s,\"shadowOnly\":%s,\"defaultEnabled\":%s,\"onNoEdge\":",m->acceptance_required?"true":"false",m->shadow_only?"true":"false",m->default_enabled?"true":"false");buf_json_string(&b,m->on_no_edge);buf_add(&b,",\"unsupportedRuntimeTypes\":[\"fanout\",\"join\",\"subgraph\"]}");
  if(include_hash){buf_add(&b,",\"manifestHash\":");buf_json_string(&b,m->manifest_hash);}buf_add(&b,"}\n");
  if(b.failed)return 0;if(len_out!=NULL)*len_out=b.len;return 1;
}

static int finalize_manifest(Manifest *m,char *out,size_t cap,size_t *len_out,Error *err) {
  size_t base_len;
  if(!validate_manifest(m,err))return 0;
  if(!serialize_manifest(m,0,out,cap,&base_len)){set_error(err,"manifest_too_large","canonical manifest exceeds %lu bytes",(unsigned long)MAX_MANIFEST_BYTES);return 0;}
  sha256_hex(out,base_len,m->manifest_hash);
  if(!serialize_manifest(m,1,out,cap,len_out)){set_error(err,"manifest_too_large","canonical manifest exceeds output buffer");return 0;}return 1;
}

/* Strict JSON syntax check plus canonical-contract extraction. */
static void json_ws(const char **p){while(**p&&isspace((unsigned char)**p))(*p)++;}
static int json_value(const char **p,int depth);
static int json_string(const char **p){if(**p!='\"')return 0;(*p)++;while(**p&&**p!='\"'){unsigned char c=(unsigned char)**p;if(c<0x20)return 0;if(c=='\\'){(*p)++;if(strchr("\"\\/bfnrt",**p)!=NULL)(*p)++;else if(**p=='u'){int i;(*p)++;for(i=0;i<4;i++){if(!isxdigit((unsigned char)**p))return 0;(*p)++;}}else return 0;}else(*p)++;}if(**p!='\"')return 0;(*p)++;return 1;}
static int json_array(const char **p,int depth){if(**p!='[')return 0;(*p)++;json_ws(p);if(**p==']'){(*p)++;return 1;}for(;;){if(!json_value(p,depth+1))return 0;json_ws(p);if(**p==']'){(*p)++;return 1;}if(**p!=',')return 0;(*p)++;json_ws(p);}}
static int json_object(const char **p,int depth){if(**p!='{')return 0;(*p)++;json_ws(p);if(**p=='}'){(*p)++;return 1;}for(;;){if(!json_string(p))return 0;json_ws(p);if(**p!=':')return 0;(*p)++;json_ws(p);if(!json_value(p,depth+1))return 0;json_ws(p);if(**p=='}'){(*p)++;return 1;}if(**p!=',')return 0;(*p)++;json_ws(p);}}
static int json_number(const char **p){const char *s=*p;if(*s=='-')s++;if(*s=='0')s++;else if(*s>='1'&&*s<='9'){do{s++;}while(isdigit((unsigned char)*s));}else return 0;if(*s=='.'){s++;if(!isdigit((unsigned char)*s))return 0;do{s++;}while(isdigit((unsigned char)*s));}if(*s=='e'||*s=='E'){s++;if(*s=='+'||*s=='-')s++;if(!isdigit((unsigned char)*s))return 0;do{s++;}while(isdigit((unsigned char)*s));}*p=s;return 1;}
static int json_value(const char **p,int depth){if(depth>64)return 0;json_ws(p);if(**p=='{')return json_object(p,depth);if(**p=='[')return json_array(p,depth);if(**p=='\"')return json_string(p);if(strncmp(*p,"true",4)==0){*p+=4;return 1;}if(strncmp(*p,"false",5)==0){*p+=5;return 1;}if(strncmp(*p,"null",4)==0){*p+=4;return 1;}if(**p=='-'||isdigit((unsigned char)**p))return json_number(p);return 0;}
static int json_valid(const char *s){const char *p=s;if(!json_value(&p,0))return 0;json_ws(&p);return *p=='\0';}

typedef enum {JSON_STRING_VALUE,JSON_INTEGER_VALUE,JSON_BOOLEAN_VALUE,JSON_ARRAY_VALUE,JSON_OBJECT_VALUE} JsonExpectedType;
typedef struct {const char *name;JsonExpectedType type;} JsonFieldSpec;
typedef struct {const char *start,*end;} JsonSpan;

static int json_string_copy(const char **p,char *out,size_t cap){size_t n=0;if(**p!='\"'||cap==0)return 0;(*p)++;while(**p&&**p!='\"'){unsigned char c=(unsigned char)**p;char value;if(c<0x20)return 0;if(c!='\\'){value=(char)c;(*p)++;}else{unsigned code=0;int i;(*p)++;if(**p=='u'){(*p)++;for(i=0;i<4;i++){unsigned char h=(unsigned char)**p;if(!isxdigit(h))return 0;code=(code<<4)|(unsigned)(isdigit(h)?h-'0':(tolower(h)-'a'+10));(*p)++;}value=code<=0x7f?(char)code:'?';}else{if(strchr("\"\\/bfnrt",**p)==NULL)return 0;switch(**p){case 'b':value='\b';break;case 'f':value='\f';break;case 'n':value='\n';break;case 'r':value='\r';break;case 't':value='\t';break;default:value=**p;break;}(*p)++;}}if(n+1>=cap)return 0;out[n++]=value;}if(**p!='\"')return 0;(*p)++;out[n]='\0';return 1;}

static int span_type_is(JsonSpan value,JsonExpectedType type){const char *p=value.start;if(p==NULL)return 0;switch(type){case JSON_STRING_VALUE:return *p=='\"';case JSON_INTEGER_VALUE:while(p<value.end&&(*p=='-'||isdigit((unsigned char)*p)))p++;return p==value.end;case JSON_BOOLEAN_VALUE:return (value.end-value.start==4&&strncmp(value.start,"true",4)==0)||(value.end-value.start==5&&strncmp(value.start,"false",5)==0);case JSON_ARRAY_VALUE:return *p=='[';case JSON_OBJECT_VALUE:return *p=='{';}return 0;}

static int object_fields(const char *object,const char *limit,const JsonFieldSpec *specs,size_t spec_count,JsonSpan *values,const char *scope,Error *err){const char *p=object;uint32_t seen=0,required;size_t i;if(spec_count==0||spec_count>31||p>=limit||*p!='{'){set_error(err,"schema_type_mismatch","%s must be an object",scope);return 0;}for(i=0;i<spec_count;i++){values[i].start=NULL;values[i].end=NULL;}required=((uint32_t)1U<<spec_count)-1U;p++;json_ws(&p);if(p<limit&&*p=='}')p++;else for(;;){char key[128];const char *value_start,*value_end;int found=-1;if(p>=limit||!json_string_copy(&p,key,sizeof(key))){set_error(err,"invalid_json","invalid %s property name",scope);return 0;}for(i=0;i<spec_count;i++)if(strcmp(key,specs[i].name)==0){found=(int)i;break;}if(found<0){set_error(err,"schema_additional_property","%s contains unsupported property %s",scope,key);return 0;}if((seen&((uint32_t)1U<<(unsigned)found))!=0){set_error(err,"schema_duplicate_property","%s contains duplicate property %s",scope,key);return 0;}json_ws(&p);if(p>=limit||*p!=':'){set_error(err,"invalid_json","%s property %s has no colon",scope,key);return 0;}p++;json_ws(&p);value_start=p;if(!json_value(&p,1)||p>limit){set_error(err,"invalid_json","%s property %s has invalid value",scope,key);return 0;}value_end=p;if(!span_type_is((JsonSpan){value_start,value_end},specs[found].type)){set_error(err,"schema_type_mismatch","%s property %s has wrong type",scope,key);return 0;}values[found].start=value_start;values[found].end=value_end;seen|=(uint32_t)1U<<(unsigned)found;json_ws(&p);if(p>=limit){set_error(err,"invalid_json","unterminated %s object",scope);return 0;}if(*p=='}'){p++;break;}if(*p!=','){set_error(err,"invalid_json","invalid separator in %s",scope);return 0;}p++;json_ws(&p);}json_ws(&p);if(p!=limit){set_error(err,"invalid_json","trailing content in %s",scope);return 0;}if(seen!=required){for(i=0;i<spec_count;i++)if((seen&((uint32_t)1U<<i))==0){set_error(err,"missing_required_field","%s is missing %s",scope,specs[i].name);return 0;}}return 1;}

static int span_string_value(JsonSpan value,char *out,size_t cap){const char *p=value.start;if(!json_string_copy(&p,out,cap))return 0;return p==value.end;}
static int span_long_value(JsonSpan value,long *out){char buf[64],*end;size_t n=(size_t)(value.end-value.start);if(n==0||n>=sizeof(buf))return 0;memcpy(buf,value.start,n);buf[n]='\0';errno=0;*out=strtol(buf,&end,10);return *end=='\0'&&errno!=ERANGE;}
static int span_bool_value(JsonSpan value,int *out){if(value.end-value.start==4&&strncmp(value.start,"true",4)==0){*out=1;return 1;}if(value.end-value.start==5&&strncmp(value.start,"false",5)==0){*out=0;return 1;}return 0;}
static int identifier_string(const char *s){size_t i,n=strlen(s);if(n<1||n>ID_LEN)return 0;for(i=0;i<n;i++)if(!(isalnum((unsigned char)s[i])||s[i]=='_'||s[i]=='.'||s[i]=='-'))return 0;return 1;}
static int semver_string(const char *s){int parts=0,digits=0;for(;*s;s++){if(isdigit((unsigned char)*s))digits=1;else if(*s=='.'&&digits&&parts<2){parts++;digits=0;}else return 0;}return parts==2&&digits;}
static int string_in(const char *value,const char *const *values,size_t count){size_t i;for(i=0;i<count;i++)if(strcmp(value,values[i])==0)return 1;return 0;}

static int validate_node_array_contract(JsonSpan array,Error *err){static const JsonFieldSpec fields[]={{"id",JSON_STRING_VALUE},{"type",JSON_STRING_VALUE},{"agentRole",JSON_STRING_VALUE},{"timeoutMs",JSON_INTEGER_VALUE}};static const char *types[]={"agent","tool","script","router","human_gate","end","fanout","join","subgraph"};const char *p=array.start+1;size_t count=0;json_ws(&p);if(p<array.end&&*p==']'){set_error(err,"schema_constraint_violation","nodes requires at least one item");return 0;}for(;;){const char *item_end=p;JsonSpan values[4];char id[ID_LEN+1],type[32],role[ID_LEN+1];long timeout;if(*p!='{'||!json_value(&item_end,1)||item_end>array.end||!object_fields(p,item_end,fields,4,values,"node",err))return 0;if(!span_string_value(values[0],id,sizeof(id))||!identifier_string(id)||!span_string_value(values[1],type,sizeof(type))||!span_string_value(values[2],role,sizeof(role))||strlen(role)>ID_LEN||!span_long_value(values[3],&timeout)||timeout<0||timeout>7200000){set_error(err,"schema_constraint_violation","node %lu violates yutu-graph@1 constraints",(unsigned long)count);return 0;}if(!string_in(type,types,sizeof(types)/sizeof(types[0]))){set_error(err,"unknown_node_type","node %s type=%s",id,type);return 0;}count++;if(count>MAX_NODES){set_error(err,"schema_constraint_violation","nodes exceeds %d items",MAX_NODES);return 0;}p=item_end;json_ws(&p);if(p>=array.end){set_error(err,"invalid_json","unterminated nodes array");return 0;}if(*p==']'){p++;break;}if(*p!=','){set_error(err,"invalid_json","invalid nodes separator");return 0;}p++;json_ws(&p);}return p==array.end;}

static int validate_edge_array_contract(JsonSpan array,Error *err){static const JsonFieldSpec fields[]={{"from",JSON_STRING_VALUE},{"to",JSON_STRING_VALUE},{"when",JSON_STRING_VALUE},{"reasonCode",JSON_STRING_VALUE},{"delivery",JSON_STRING_VALUE}};static const char *deliveries[]={"single","fanout","join"};const char *p=array.start+1;size_t count=0;json_ws(&p);if(p<array.end&&*p==']'){set_error(err,"schema_constraint_violation","edges requires at least one item");return 0;}for(;;){const char *item_end=p;JsonSpan values[5];char from[ID_LEN+1],to[ID_LEN+1],when[CONDITION_LEN+1],reason[ID_LEN+1],delivery[16];if(*p!='{'||!json_value(&item_end,1)||item_end>array.end||!object_fields(p,item_end,fields,5,values,"edge",err))return 0;if(!span_string_value(values[0],from,sizeof(from))||from[0]=='\0'||!span_string_value(values[1],to,sizeof(to))||to[0]=='\0'||!span_string_value(values[2],when,sizeof(when))||!span_string_value(values[3],reason,sizeof(reason))||reason[0]=='\0'||!span_string_value(values[4],delivery,sizeof(delivery))||!string_in(delivery,deliveries,sizeof(deliveries)/sizeof(deliveries[0]))){set_error(err,"schema_constraint_violation","edge %lu violates yutu-graph@1 constraints",(unsigned long)count);return 0;}count++;if(count>MAX_EDGES){set_error(err,"schema_constraint_violation","edges exceeds %d items",MAX_EDGES);return 0;}p=item_end;json_ws(&p);if(p>=array.end){set_error(err,"invalid_json","unterminated edges array");return 0;}if(*p==']'){p++;break;}if(*p!=','){set_error(err,"invalid_json","invalid edges separator");return 0;}p++;json_ws(&p);}return p==array.end;}

static int validate_unsupported_types_const(JsonSpan array,Error *err){static const char *expected[]={"fanout","join","subgraph"};const char *p=array.start+1;size_t i;for(i=0;i<3;i++){const char *end;char value[32];json_ws(&p);end=p;if(!json_value(&end,1)||!span_string_value((JsonSpan){p,end},value,sizeof(value))||strcmp(value,expected[i])!=0){set_error(err,"schema_constraint_violation","unsupportedRuntimeTypes must equal [fanout,join,subgraph]");return 0;}p=end;json_ws(&p);if(i<2){if(*p!=',')return 0;p++;}}json_ws(&p);if(*p!=']'||p+1!=array.end){set_error(err,"schema_constraint_violation","unsupportedRuntimeTypes must contain exactly three items");return 0;}return 1;}

static int validate_manifest_contract(const char *json,Error *err){static const JsonFieldSpec root_fields[]={{"schemaVersion",JSON_STRING_VALUE},{"graphId",JSON_STRING_VALUE},{"graphVersion",JSON_STRING_VALUE},{"projectId",JSON_STRING_VALUE},{"objectiveRef",JSON_STRING_VALUE},{"sourceSha256",JSON_STRING_VALUE},{"startNode",JSON_STRING_VALUE},{"nodes",JSON_ARRAY_VALUE},{"edges",JSON_ARRAY_VALUE},{"budgets",JSON_OBJECT_VALUE},{"policies",JSON_OBJECT_VALUE},{"manifestHash",JSON_STRING_VALUE}};static const JsonFieldSpec budget_fields[]={{"maxLoops",JSON_INTEGER_VALUE},{"wallTimeoutMs",JSON_INTEGER_VALUE},{"maxInputBytes",JSON_INTEGER_VALUE},{"maxManifestBytes",JSON_INTEGER_VALUE},{"maxMemoryBytes",JSON_INTEGER_VALUE}};static const JsonFieldSpec policy_fields[]={{"acceptanceRequired",JSON_BOOLEAN_VALUE},{"shadowOnly",JSON_BOOLEAN_VALUE},{"defaultEnabled",JSON_BOOLEAN_VALUE},{"onNoEdge",JSON_STRING_VALUE},{"unsupportedRuntimeTypes",JSON_ARRAY_VALUE}};const char *limit=json+strlen(json);JsonSpan root[12],budgets[5],policies[5];char schema[32],graph_id[ID_LEN+1],version[32],project[ID_LEN+1],objective[TEXT_LEN+1],source[65],start[ID_LEN+1],hash[65],on_no_edge[ID_LEN+1];long max_loops,timeout,input_bytes,manifest_bytes,memory_bytes;int acceptance,shadow,enabled;if(!object_fields(json,limit,root_fields,12,root,"manifest",err))return 0;if(!span_string_value(root[0],schema,sizeof(schema))||strcmp(schema,SCHEMA_VERSION)!=0||!span_string_value(root[1],graph_id,sizeof(graph_id))||graph_id[0]=='\0'||!span_string_value(root[2],version,sizeof(version))||!semver_string(version)||!span_string_value(root[3],project,sizeof(project))||project[0]=='\0'||!span_string_value(root[4],objective,sizeof(objective))||objective[0]=='\0'||!span_string_value(root[5],source,sizeof(source))||!is_sha256(source)||!span_string_value(root[6],start,sizeof(start))||start[0]=='\0'||!span_string_value(root[11],hash,sizeof(hash))||!is_sha256(hash)){set_error(err,"schema_constraint_violation","manifest identity fields violate yutu-graph@1");return 0;}if(!validate_node_array_contract(root[7],err)||!validate_edge_array_contract(root[8],err))return 0;if(!object_fields(root[9].start,root[9].end,budget_fields,5,budgets,"budgets",err))return 0;if(!span_long_value(budgets[0],&max_loops)||!span_long_value(budgets[1],&timeout)||!span_long_value(budgets[2],&input_bytes)||!span_long_value(budgets[3],&manifest_bytes)||!span_long_value(budgets[4],&memory_bytes)||max_loops<1||max_loops>3||timeout<1||timeout>7200000||input_bytes!=(long)MAX_INPUT_BYTES||manifest_bytes!=(long)MAX_MANIFEST_BYTES||memory_bytes!=(long)MAX_MEMORY_BYTES){set_error(err,"schema_constraint_violation","budgets violate yutu-graph@1");return 0;}if(!object_fields(root[10].start,root[10].end,policy_fields,5,policies,"policies",err))return 0;if(!span_bool_value(policies[0],&acceptance)||!span_bool_value(policies[1],&shadow)||!span_bool_value(policies[2],&enabled)||!span_string_value(policies[3],on_no_edge,sizeof(on_no_edge))||!shadow||enabled){set_error(err,"schema_constraint_violation","policies violate yutu-graph@1");return 0;}if(!validate_unsupported_types_const(policies[4],err))return 0;(void)acceptance;return 1;}

static const char *find_key(const char *start,const char *end,const char *key){char pattern[160];const char *p;snprintf(pattern,sizeof(pattern),"\"%s\"",key);p=start;while((p=strstr(p,pattern))!=NULL&&p<end){const char *q=p+strlen(pattern);while(q<end&&isspace((unsigned char)*q))q++;if(q<end&&*q==':'){q++;while(q<end&&isspace((unsigned char)*q))q++;return q;}p+=strlen(pattern);}return NULL;}
static int extract_string_range(const char *start,const char *end,const char *key,char *out,size_t cap){const char *p=find_key(start,end,key);size_t n=0;if(p==NULL||p>=end||*p!='\"'||cap==0)return 0;p++;while(p<end&&*p!='\"'){char value;if(n+1>=cap)return 0;if(*p=='\\'){p++;if(p>=end)return 0;if(*p=='n')value='\n';else if(*p=='r')value='\r';else if(*p=='t')value='\t';else value=*p;p++;}else value=*p++;out[n++]=value;}if(p>=end||*p!='\"')return 0;out[n]='\0';return 1;}
static int extract_long_range(const char *start,const char *end,const char *key,long *out){const char *p=find_key(start,end,key);char *q;if(p==NULL||p>=end)return 0;errno=0;*out=strtol(p,&q,10);return q!=p&&q<=end&&errno!=ERANGE;}
static int extract_bool_range(const char *start,const char *end,const char *key,int *out){const char *p=find_key(start,end,key);if(p==NULL||p>=end)return 0;if((size_t)(end-p)>=4&&strncmp(p,"true",4)==0){*out=1;return 1;}if((size_t)(end-p)>=5&&strncmp(p,"false",5)==0){*out=0;return 1;}return 0;}
static const char *match_close(const char *open,char left,char right){const char *p=open;int depth=0;char quote=0;for(;*p;p++){char c=*p;if(quote){if(c=='\\'&&p[1])p++;else if(c==quote)quote=0;continue;}if(c=='\"'){quote=c;continue;}if(c==left)depth++;else if(c==right){depth--;if(depth==0)return p;}}return NULL;}

static int parse_manifest_json(const char *json,Manifest *m,Error *err) {
  const char *end=json+strlen(json),*arr,*arr_end,*p;manifest_init(m);
  if(!json_valid(json)){set_error(err,"invalid_json","manifest is not valid JSON");return 0;}
  if(!validate_manifest_contract(json,err))return 0;
  if(!extract_string_range(json,end,"schemaVersion",m->schema,sizeof(m->schema))||!extract_string_range(json,end,"graphId",m->graph_id,sizeof(m->graph_id))||!extract_string_range(json,end,"graphVersion",m->graph_version,sizeof(m->graph_version))||!extract_string_range(json,end,"projectId",m->project_id,sizeof(m->project_id))||!extract_string_range(json,end,"objectiveRef",m->objective_ref,sizeof(m->objective_ref))||!extract_string_range(json,end,"sourceSha256",m->source_sha,sizeof(m->source_sha))||!extract_string_range(json,end,"startNode",m->start_node,sizeof(m->start_node))||!extract_string_range(json,end,"manifestHash",m->manifest_hash,sizeof(m->manifest_hash))){set_error(err,"missing_required_field","manifest identity/hash field missing");return 0;}
  arr=find_key(json,end,"nodes");if(arr==NULL||*arr!='['||(arr_end=match_close(arr,'[',']'))==NULL){set_error(err,"missing_required_field","nodes array missing");return 0;}
  p=arr+1;while(p<arr_end){while(p<arr_end&&(*p==','||isspace((unsigned char)*p)))p++;if(p>=arr_end)break;if(*p!='{'){set_error(err,"invalid_node","node must be object");return 0;}const char *obj_end=match_close(p,'{','}');Node *n;if(obj_end==NULL||obj_end>arr_end||m->node_count>=MAX_NODES){set_error(err,"invalid_node","node object/limit invalid");return 0;}n=&m->nodes[m->node_count];memset(n,0,sizeof(*n));if(!extract_string_range(p,obj_end,"id",n->id,sizeof(n->id))||!extract_string_range(p,obj_end,"type",n->type,sizeof(n->type))||!extract_string_range(p,obj_end,"agentRole",n->role,sizeof(n->role))||!extract_long_range(p,obj_end,"timeoutMs",&n->timeout_ms)){set_error(err,"invalid_node","node required field missing");return 0;}m->node_count++;p=obj_end+1;}
  arr=find_key(json,end,"edges");if(arr==NULL||*arr!='['||(arr_end=match_close(arr,'[',']'))==NULL){set_error(err,"missing_required_field","edges array missing");return 0;}
  p=arr+1;while(p<arr_end){while(p<arr_end&&(*p==','||isspace((unsigned char)*p)))p++;if(p>=arr_end)break;if(*p!='{'){set_error(err,"invalid_edge","edge must be object");return 0;}const char *obj_end=match_close(p,'{','}');Edge *e;if(obj_end==NULL||obj_end>arr_end||m->edge_count>=MAX_EDGES){set_error(err,"invalid_edge","edge object/limit invalid");return 0;}e=&m->edges[m->edge_count];memset(e,0,sizeof(*e));if(!extract_string_range(p,obj_end,"from",e->from,sizeof(e->from))||!extract_string_range(p,obj_end,"to",e->to,sizeof(e->to))||!extract_string_range(p,obj_end,"when",e->when,sizeof(e->when))||!extract_string_range(p,obj_end,"reasonCode",e->reason,sizeof(e->reason))||!extract_string_range(p,obj_end,"delivery",e->delivery,sizeof(e->delivery))){set_error(err,"invalid_edge","edge required field missing");return 0;}m->edge_count++;p=obj_end+1;}
  if(!extract_long_range(json,end,"maxLoops",&m->max_loops)||!extract_long_range(json,end,"wallTimeoutMs",&m->wall_timeout_ms)||!extract_long_range(json,end,"maxInputBytes",&m->max_input_bytes)||!extract_long_range(json,end,"maxManifestBytes",&m->max_manifest_bytes)||!extract_long_range(json,end,"maxMemoryBytes",&m->max_memory_bytes)||!extract_bool_range(json,end,"acceptanceRequired",&m->acceptance_required)||!extract_bool_range(json,end,"shadowOnly",&m->shadow_only)||!extract_bool_range(json,end,"defaultEnabled",&m->default_enabled)||!extract_string_range(json,end,"onNoEdge",m->on_no_edge,sizeof(m->on_no_edge))){set_error(err,"missing_required_field","budgets/policies field missing");return 0;}
  qsort(m->nodes,m->node_count,sizeof(Node),node_cmp);qsort(m->edges,m->edge_count,sizeof(Edge),edge_cmp);return 1;
}

static int verify_manifest_hash(Manifest *m,Error *err){char *base;size_t len;char actual[65];base=(char *)tracked_malloc(MAX_MANIFEST_BYTES+1,err);if(base==NULL)return 0;if(!serialize_manifest(m,0,base,MAX_MANIFEST_BYTES+1,&len)){tracked_free(base);set_error(err,"manifest_too_large","cannot canonicalize manifest");return 0;}sha256_hex(base,len,actual);tracked_free(base);if(strcmp(actual,m->manifest_hash)!=0){set_error(err,"manifest_hash_mismatch","expected %s actual %s",m->manifest_hash,actual);return 0;}return 1;}

static int atomic_write(const char *path,const char *data,size_t len,Error *err){char tmp[PATH_MAX];FILE *fp;snprintf(tmp,sizeof(tmp),"%s.tmp-%ld",path,(long)getpid());fp=fopen(tmp,"wb");if(fp==NULL){set_error(err,"write_failed","cannot open %s: %s",tmp,strerror(errno));return 0;}if(fwrite(data,1,len,fp)!=len||fflush(fp)!=0){fclose(fp);unlink(tmp);set_error(err,"write_failed","cannot write %s",tmp);return 0;}if(fclose(fp)!=0||rename(tmp,path)!=0){unlink(tmp);set_error(err,"write_failed","cannot publish %s: %s",path,strerror(errno));return 0;}return 1;}

static int compile_file(const char *path,Manifest *m,char *out,size_t cap,size_t *len_out,Error *err){char *raw;size_t len;int ok;raw=read_file_limited(path,MAX_INPUT_BYTES,&len,err);if(raw==NULL)return 0;ok=compile_yaml_mutable(raw,raw,len,m,err)&&finalize_manifest(m,out,cap,len_out,err);tracked_free(raw);return ok;}

typedef struct { char file[TEXT_LEN+1],source_sha[65],manifest_hash[65]; } Revision;
static int name_cmp(const void *a,const void *b){return strcmp((const char *)a,(const char *)b);}
static int revision_cmp(const void *a,const void *b){return strcmp(((const Revision *)a)->file,((const Revision *)b)->file);}
static int find_revision(const Revision *revs,size_t count,const char *file){size_t i;for(i=0;i<count;i++)if(strcmp(revs[i].file,file)==0)return (int)i;return -1;}
static int name_list_has(char names[16][TEXT_LEN+1],size_t count,const char *file){size_t i;for(i=0;i<count;i++)if(strcmp(names[i],file)==0)return 1;return 0;}
static long long monotonic_ms(void){struct timespec ts;clock_gettime(CLOCK_MONOTONIC,&ts);return (long long)ts.tv_sec*1000LL+ts.tv_nsec/1000000LL;}
static int gather_revisions(const char *dir,char names[16][TEXT_LEN+1],size_t *count,int *done,Error *err){DIR *dp;struct dirent *de;char path[PATH_MAX];struct stat st;*count=0;*done=0;dp=opendir(dir);if(dp==NULL){set_error(err,"review_input_unreadable","cannot open %s",dir);return 0;}while((de=readdir(dp))!=NULL){size_t n=strlen(de->d_name);if(strcmp(de->d_name,"DONE")==0){*done=1;continue;}if(n<5||strcmp(de->d_name+n-5,".yaml")!=0)continue;if(*count>=16){closedir(dp);set_error(err,"max_iterations_exceeded","more than 16 revisions");return 0;}snprintf(path,sizeof(path),"%s/%s",dir,de->d_name);if(stat(path,&st)!=0||!S_ISREG(st.st_mode))continue;snprintf(names[*count],TEXT_LEN+1,"%s",de->d_name);(*count)++;}closedir(dp);qsort(names,*count,sizeof(names[0]),name_cmp);return 1;}

static int write_review_receipt(const char *path,const char *status,const char *error_code,const char *detail,Revision *revs,size_t count,Error *err){char *data;Buffer b;size_t i;data=(char *)tracked_malloc(65536,err);if(data==NULL)return 0;buf_init(&b,data,65536);buf_add(&b,"{\"schema\":\"yutu-review-compile@1\",\"trigger\":\"filesystem_poll_500ms\",\"external_agent_required\":false,\"human_gate_required\":false,\"max_iterations\":3,\"timeout_ms\":5000,\"max_input_bytes\":1048576,\"max_manifest_bytes\":1048576,\"max_memory_bytes\":8388608,\"status\":");buf_json_string(&b,status);buf_add(&b,",\"error_code\":");buf_json_string(&b,error_code==NULL?"":error_code);buf_add(&b,",\"detail\":");buf_json_string(&b,detail==NULL?"":detail);buf_add(&b,",\"iterations\":[");for(i=0;i<count;i++){if(i)buf_add(&b,",");buf_add(&b,"{\"file\":");buf_json_string(&b,revs[i].file);buf_add(&b,",\"source_sha256\":");buf_json_string(&b,revs[i].source_sha);buf_add(&b,",\"manifest_hash\":");buf_json_string(&b,revs[i].manifest_hash);buf_add(&b,"}");}buf_add(&b,"],\"iteration_count\":%lu,\"tracked_peak_bytes\":%lu,\"verdict\":",(unsigned long)count,(unsigned long)tracked_peak);buf_json_string(&b,strcmp(status,"complete")==0?"done":"fail");buf_add(&b,"}\n");if(b.failed){tracked_free(data);set_error(err,"receipt_too_large","review receipt overflow");return 0;}if(!atomic_write(path,data,b.len,err)){tracked_free(data);return 0;}tracked_free(data);return 1;}

static int run_review_loop(const char *dir,const char *receipt){long long start=monotonic_ms();Revision revs[MAX_REVISIONS];size_t processed=0;Error err={{0},{0}};memset(revs,0,sizeof(revs));for(;;){char names[16][TEXT_LEN+1];size_t count=0,i;int done=0;if(!gather_revisions(dir,names,&count,&done,&err)){write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}if(count>MAX_REVISIONS){set_error(&err,"max_iterations_exceeded","revision count=%lu limit=%d",(unsigned long)count,MAX_REVISIONS);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}for(i=0;i<processed;i++)if(!name_list_has(names,count,revs[i].file)){set_error(&err,"revision_removed","revision %s disappeared after compilation",revs[i].file);qsort(revs,processed,sizeof(Revision),revision_cmp);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}for(i=0;i<count;i++){char path[PATH_MAX];int prior=find_revision(revs,processed,names[i]);snprintf(path,sizeof(path),"%s/%s",dir,names[i]);if(prior>=0){char *raw;size_t raw_len;char actual_sha[65];raw=read_file_limited(path,MAX_INPUT_BYTES,&raw_len,&err);if(raw==NULL){write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);return 1;}sha256_hex(raw,raw_len,actual_sha);tracked_free(raw);if(strcmp(actual_sha,revs[prior].source_sha)!=0){set_error(&err,"revision_mutated","revision %s changed after compilation",names[i]);qsort(revs,processed,sizeof(Revision),revision_cmp);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}continue;}else{char *out;size_t out_len;Manifest m;if(processed>=MAX_REVISIONS){set_error(&err,"max_iterations_exceeded","processed revisions exceed %d",MAX_REVISIONS);qsort(revs,processed,sizeof(Revision),revision_cmp);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);return 1;}out=(char *)tracked_malloc(MAX_MANIFEST_BYTES+1,&err);if(out==NULL||!compile_file(path,&m,out,MAX_MANIFEST_BYTES+1,&out_len,&err)){tracked_free(out);qsort(revs,processed,sizeof(Revision),revision_cmp);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}snprintf(revs[processed].file,sizeof(revs[processed].file),"%s",names[i]);snprintf(revs[processed].source_sha,sizeof(revs[processed].source_sha),"%s",m.source_sha);snprintf(revs[processed].manifest_hash,sizeof(revs[processed].manifest_hash),"%s",m.manifest_hash);processed++;tracked_free(out);}}qsort(revs,processed,sizeof(Revision),revision_cmp);if(done){if(processed==0){set_error(&err,"no_revisions","DONE found without yaml revision");write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);return 1;}if(!write_review_receipt(receipt,"complete","","",revs,processed,&err)){fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}return 0;}if(monotonic_ms()-start>=REVIEW_TIMEOUT_MS){set_error(&err,"review_timeout","no DONE within %dms",REVIEW_TIMEOUT_MS);write_review_receipt(receipt,"failed",err.code,err.detail,revs,processed,&err);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}{struct timespec ts={0,REVIEW_POLL_MS*1000000L};nanosleep(&ts,NULL);}}
}

typedef struct { long seq;char type[64],task[ID_LEN+1],node[ID_LEN+1],role[ID_LEN+1],from[ID_LEN+1],to[ID_LEN+1],status[32]; } Event;
typedef struct {char version[64],source_path[TEXT_LEN+1],source_sha[65],source_mode[32],project_id[ID_LEN+1],root_task[ID_LEN+1],downstream_task[ID_LEN+1],spec_fingerprint[65],expected_node_order[TEXT_LEN+1],expected_edges[CONDITION_LEN+1],expected_terminal[32];Event events[MAX_EVENTS];size_t event_count;} Snapshot;

static int parse_snapshot(const char *json,Snapshot *s,Error *err){const char *end=json+strlen(json),*arr,*arr_end,*p;memset(s,0,sizeof(*s));if(!json_valid(json)){set_error(err,"invalid_snapshot_json","snapshot is not valid JSON");return 0;}if(!extract_string_range(json,end,"snapshot_version",s->version,sizeof(s->version))||!extract_string_range(json,end,"source_path",s->source_path,sizeof(s->source_path))||!extract_string_range(json,end,"source_sha256",s->source_sha,sizeof(s->source_sha))||!extract_string_range(json,end,"source_mode",s->source_mode,sizeof(s->source_mode))||!extract_string_range(json,end,"project_id",s->project_id,sizeof(s->project_id))||!extract_string_range(json,end,"root_task_id",s->root_task,sizeof(s->root_task))||!extract_string_range(json,end,"downstream_task_id",s->downstream_task,sizeof(s->downstream_task))||!extract_string_range(json,end,"spec_fingerprint",s->spec_fingerprint,sizeof(s->spec_fingerprint))||!extract_string_range(json,end,"expected_node_order",s->expected_node_order,sizeof(s->expected_node_order))||!extract_string_range(json,end,"expected_edges",s->expected_edges,sizeof(s->expected_edges))||!extract_string_range(json,end,"expected_terminal",s->expected_terminal,sizeof(s->expected_terminal))){set_error(err,"snapshot_missing_identity","snapshot identity/golden field missing");return 0;}if(strcmp(s->source_mode,"read_only")!=0||!is_sha256(s->source_sha)||!is_sha256(s->spec_fingerprint)){set_error(err,"snapshot_identity_invalid","source_mode/hash/spec fingerprint invalid");return 0;}arr=find_key(json,end,"events");if(arr==NULL||*arr!='['||(arr_end=match_close(arr,'[',']'))==NULL){set_error(err,"snapshot_events_missing","events array missing");return 0;}p=arr+1;while(p<arr_end){const char *obj_end;Event *e;while(p<arr_end&&(*p==','||isspace((unsigned char)*p)))p++;if(p>=arr_end)break;if(*p!='{'||(obj_end=match_close(p,'{','}'))==NULL||obj_end>arr_end||s->event_count>=MAX_EVENTS){set_error(err,"snapshot_event_invalid","event object invalid/limit exceeded");return 0;}e=&s->events[s->event_count];memset(e,0,sizeof(*e));if(!extract_long_range(p,obj_end,"seq",&e->seq)||!extract_string_range(p,obj_end,"type",e->type,sizeof(e->type))||!extract_string_range(p,obj_end,"task",e->task,sizeof(e->task))){set_error(err,"snapshot_event_invalid","event required field missing");return 0;}extract_string_range(p,obj_end,"node",e->node,sizeof(e->node));extract_string_range(p,obj_end,"role",e->role,sizeof(e->role));extract_string_range(p,obj_end,"from",e->from,sizeof(e->from));extract_string_range(p,obj_end,"to",e->to,sizeof(e->to));extract_string_range(p,obj_end,"status",e->status,sizeof(e->status));s->event_count++;p=obj_end+1;}return 1;}

static int list_has(char values[][ID_LEN+1],size_t count,const char *value){size_t i;for(i=0;i<count;i++)if(strcmp(values[i],value)==0)return 1;return 0;}
static void list_add(char values[][ID_LEN+1],size_t *count,size_t max,const char *value){if(value==NULL||*value=='\0'||*count>=max||list_has(values,*count,value))return;snprintf(values[*count],ID_LEN+1,"%s",value);(*count)++;}
typedef struct {char from[ID_LEN+1],to[ID_LEN+1];long seq;} ProjectedEdge;
static int projected_edge_has(ProjectedEdge *edges,size_t count,const char *from,const char *to){size_t i;for(i=0;i<count;i++)if(strcmp(edges[i].from,from)==0&&strcmp(edges[i].to,to)==0)return 1;return 0;}
static void projected_edge_add(ProjectedEdge *edges,size_t *count,const char *from,const char *to,long seq){if(*count>=MAX_EDGES||projected_edge_has(edges,*count,from,to))return;snprintf(edges[*count].from,sizeof(edges[*count].from),"%s",from);snprintf(edges[*count].to,sizeof(edges[*count].to),"%s",to);edges[*count].seq=seq;(*count)++;}

static int safe_log_root(const char *p){return p!=NULL&&p[0]!='/'&&strstr(p,"..") == NULL&&strncmp(p,"projects/控制台/artifacts/graph-ge01-",strlen("projects/控制台/artifacts/graph-ge01-"))==0&&strstr(p,"/shadow-logs-")!=NULL;}
static int path_under(const char *path,const char *root){size_t n=strlen(root);return strncmp(path,root,n)==0&&(path[n]=='/'||path[n]=='\0');}
static int safe_write(const char *path,const char *root,const char *data,size_t len,Error *err){if(!path_under(path,root)){set_error(err,"write_barrier_violation","%s is outside %s",path,root);return 0;}return atomic_write(path,data,len,err);}

static int run_shadow(const char *snapshot_path,const char *log_root){Error err={{0},{0}};char *raw,*report,*temp_report;size_t raw_len;Snapshot s;struct stat before,after;char snapshot_sha[65],actual_nodes[TEXT_LEN+1],actual_edges[CONDITION_LEN+1];char nodes[MAX_NODES][ID_LEN+1];size_t node_count=0,i,edge_count=0;ProjectedEdge edges[MAX_EDGES];int child_done=0,root_done=0;char temp_template[PATH_MAX],*workspace=NULL,temp_file[PATH_MAX],run_dir[PATH_MAX],log_file[PATH_MAX];time_t now;struct tm tmv;Buffer b;int ok=0;
  memset(edges,0,sizeof(edges));if(!safe_log_root(log_root)){fprintf(stderr,"write_barrier_violation: invalid retained log root\n");return 1;}if(stat(snapshot_path,&before)!=0||(before.st_mode&0222)!=0){fprintf(stderr,"snapshot_not_read_only: chmod a-w the versioned snapshot before projection\n");return 1;}
  raw=read_file_limited(snapshot_path,MAX_INPUT_BYTES,&raw_len,&err);if(raw==NULL){fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}sha256_hex(raw,raw_len,snapshot_sha);if(!parse_snapshot(raw,&s,&err)){tracked_free(raw);fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}
  for(i=0;i<s.event_count;i++){Event *e=&s.events[i];if(strcmp(e->type,"edge.take")==0){projected_edge_add(edges,&edge_count,e->from,e->to,e->seq);list_add(nodes,&node_count,MAX_NODES,e->from);list_add(nodes,&node_count,MAX_NODES,e->to);}else if(strcmp(e->type,"node.start")==0){const char *mapped=strcmp(e->node,"orchestrator-plan")==0?"orchestrator":e->node;list_add(nodes,&node_count,MAX_NODES,mapped);}else if(strcmp(e->type,"task.done")==0&&strcmp(e->task,s.downstream_task)==0)child_done=1;else if(strcmp(e->type,"project.route.done")==0&&strcmp(e->task,s.root_task)==0)root_done=1;}
  if(projected_edge_has(edges,edge_count,"orchestrator","supervisor")&&!projected_edge_has(edges,edge_count,"supervisor","implement")){size_t k;if(edge_count>=MAX_EDGES){set_error(&err,"edge_limit_exceeded","shadow edges overflow");goto cleanup;}for(k=edge_count;k>1;k--)edges[k]=edges[k-1];snprintf(edges[1].from,sizeof(edges[1].from),"supervisor");snprintf(edges[1].to,sizeof(edges[1].to),"implement");edges[1].seq=0;edge_count++;if(!list_has(nodes,node_count,"supervisor"))list_add(nodes,&node_count,MAX_NODES,"supervisor");}
  if(!child_done||!root_done){set_error(&err,"shadow_terminal_mismatch","child/root terminal event missing");goto cleanup;}
  {Buffer expected;buf_init(&expected,actual_nodes,sizeof(actual_nodes));for(i=0;i<node_count;i++){if(i)buf_add(&expected,">");buf_add(&expected,"%s",nodes[i]);}if(expected.failed){set_error(&err,"equivalence_mismatch","node order overflow");goto cleanup;}buf_init(&expected,actual_edges,sizeof(actual_edges));for(i=0;i<edge_count;i++){if(i)buf_add(&expected,"|");buf_add(&expected,"%s>%s",edges[i].from,edges[i].to);}if(expected.failed||strcmp(actual_nodes,s.expected_node_order)!=0||strcmp(actual_edges,s.expected_edges)!=0||strcmp(s.expected_terminal,"done")!=0){set_error(&err,"equivalence_mismatch","nodes=%s edges=%s terminal=done",actual_nodes,actual_edges);goto cleanup;}}
  snprintf(temp_template,sizeof(temp_template),"%s/yutu-shadow-%ld-XXXXXX",getenv("TMPDIR")?getenv("TMPDIR"):"/tmp",(long)getpid());workspace=mkdtemp(temp_template);if(workspace==NULL){set_error(&err,"shadow_temp_failed","mkdtemp failed: %s",strerror(errno));goto cleanup;}
  temp_report=(char *)tracked_malloc(MAX_MANIFEST_BYTES+1,&err);if(temp_report==NULL)goto cleanup;buf_init(&b,temp_report,MAX_MANIFEST_BYTES+1);buf_add(&b,"{\"schema\":\"yutu-shadow-projection@1\",\"snapshot_version\":");buf_json_string(&b,s.version);buf_add(&b,",\"snapshot_sha256\":");buf_json_string(&b,snapshot_sha);buf_add(&b,",\"source_path\":");buf_json_string(&b,s.source_path);buf_add(&b,",\"source_sha256\":");buf_json_string(&b,s.source_sha);buf_add(&b,",\"source_mode\":\"read_only\",\"project_id\":");buf_json_string(&b,s.project_id);buf_add(&b,",\"root_task_id\":");buf_json_string(&b,s.root_task);buf_add(&b,",\"downstream_task_id\":");buf_json_string(&b,s.downstream_task);buf_add(&b,",\"spec_fingerprint\":");buf_json_string(&b,s.spec_fingerprint);buf_add(&b,",\"canonical_nodes\":[");
  for(i=0;i<node_count;i++){if(i)buf_add(&b,",");buf_json_string(&b,nodes[i]);}buf_add(&b,"],\"canonical_edges\":[");for(i=0;i<edge_count;i++){if(i)buf_add(&b,",");buf_add(&b,"{\"from\":");buf_json_string(&b,edges[i].from);buf_add(&b,",\"to\":");buf_json_string(&b,edges[i].to);buf_add(&b,",\"evidence_seq\":%ld}",edges[i].seq);}buf_add(&b,"],\"terminal\":\"done\",\"identity_match\":true,\"mapping_evidence\":[\"edge.take events preserve observed edges\",\"project.routed plus downstream task.queued maps supervisor->implement\",\"task.done plus project.route.done maps terminal done\"],\"gaps\":[\"supervisor->implement has no explicit edge.take in the legacy trace; queue identity supplies the offline mapping\"],\"write_barrier\":{\"temporary_namespace\":\"yutu-shadow-*\",\"retained_namespace\":\"graph-ge01-*/shadow-logs-*\"},\"temporary_data_cleaned\":true}\n");
  if(b.failed){tracked_free(temp_report);set_error(&err,"shadow_report_too_large","projection report overflow");goto cleanup;}snprintf(temp_file,sizeof(temp_file),"%s/projection.json",workspace);if(!safe_write(temp_file,workspace,temp_report,b.len,&err)){tracked_free(temp_report);goto cleanup;}
  if(unlink(temp_file)!=0||rmdir(workspace)!=0){tracked_free(temp_report);set_error(&err,"shadow_cleanup_failed","cannot remove temporary namespace");workspace=NULL;goto cleanup;}workspace=NULL;
  now=time(NULL);gmtime_r(&now,&tmv);char stamp[32];strftime(stamp,sizeof(stamp),"%Y%m%dT%H%M%SZ",&tmv);snprintf(run_dir,sizeof(run_dir),"%s/%s-%ld",log_root,stamp,(long)getpid());if(mkdir(run_dir,0700)!=0){tracked_free(temp_report);set_error(&err,"write_failed","cannot create retained log dir %s",run_dir);goto cleanup;}snprintf(log_file,sizeof(log_file),"%s/report.json",run_dir);if(!safe_write(log_file,run_dir,temp_report,b.len,&err)){tracked_free(temp_report);goto cleanup;}tracked_free(temp_report);
  if(stat(snapshot_path,&after)!=0||before.st_size!=after.st_size||before.st_mtime!=after.st_mtime||(before.st_mode&0777)!=(after.st_mode&0777)){set_error(&err,"snapshot_mutated","snapshot stat changed during projection");goto cleanup;}
  report=(char *)tracked_malloc(1024,&err);if(report==NULL)goto cleanup;Buffer stdout_buf;buf_init(&stdout_buf,report,1024);buf_add(&stdout_buf,"{\"ok\":true,\"log\":");buf_json_string(&stdout_buf,log_file);buf_add(&stdout_buf,",\"temporary_data_cleaned\":true,\"snapshot_sha256\":");buf_json_string(&stdout_buf,snapshot_sha);buf_add(&stdout_buf,"}\n");fwrite(report,1,stdout_buf.len,stdout);tracked_free(report);ok=1;
cleanup:
  if(workspace!=NULL){snprintf(temp_file,sizeof(temp_file),"%s/projection.json",workspace);unlink(temp_file);rmdir(workspace);}tracked_free(raw);if(!ok){fprintf(stderr,"%s: %s\n",err.code[0]?err.code:"shadow_failed",err.detail[0]?err.detail:"unknown");return 1;}return 0;}

static int double_cmp(const void *a,const void *b){double x=*(const double *)a,y=*(const double *)b;return x<y?-1:x>y?1:0;}
static int run_bench(const char *flow,long iterations){Error err={{0},{0}};char *raw,*scratch,*out;size_t raw_len,out_len;double *times;long i,warmup=100;struct timespec a,b;Manifest m;if(iterations<101||iterations>100000){fprintf(stderr,"iterations must be 101..100000\n");return 1;}raw=read_file_limited(flow,MAX_INPUT_BYTES,&raw_len,&err);if(raw==NULL){fprintf(stderr,"%s: %s\n",err.code,err.detail);return 1;}scratch=(char *)tracked_malloc(raw_len+1,&err);out=(char *)tracked_malloc(MAX_MANIFEST_BYTES+1,&err);times=(double *)tracked_malloc((size_t)iterations*sizeof(double),&err);if(scratch==NULL||out==NULL||times==NULL){tracked_free(raw);tracked_free(scratch);tracked_free(out);tracked_free(times);return 1;}for(i=0;i<warmup;i++){memcpy(scratch,raw,raw_len+1);if(!compile_yaml_mutable(scratch,raw,raw_len,&m,&err)||!finalize_manifest(&m,out,MAX_MANIFEST_BYTES+1,&out_len,&err)){fprintf(stderr,"%s: %s\n",err.code,err.detail);goto fail;}}
  for(i=0;i<iterations;i++){memcpy(scratch,raw,raw_len+1);clock_gettime(CLOCK_MONOTONIC,&a);if(!compile_yaml_mutable(scratch,raw,raw_len,&m,&err)||!finalize_manifest(&m,out,MAX_MANIFEST_BYTES+1,&out_len,&err)){fprintf(stderr,"%s: %s\n",err.code,err.detail);goto fail;}clock_gettime(CLOCK_MONOTONIC,&b);times[i]=(double)(b.tv_sec-a.tv_sec)*1000000.0+(double)(b.tv_nsec-a.tv_nsec)/1000.0;}
  qsort(times,(size_t)iterations,sizeof(double),double_cmp);long p50=(iterations-1)/2,p99=(long)((double)iterations*0.99);if(p99>=iterations)p99=iterations-1;printf("{\"schema\":\"yutu-graph-benchmark@1\",\"implementation\":\"c11-stdlib\",\"input_sha256\":\"%s\",\"warmup\":%ld,\"iterations\":%ld,\"p50_us\":%.3f,\"p99_us\":%.3f,\"tracked_peak_bytes\":%lu}\n",m.source_sha,warmup,iterations,times[p50],times[p99],(unsigned long)tracked_peak);tracked_free(raw);tracked_free(scratch);tracked_free(out);tracked_free(times);return 0;
fail:tracked_free(raw);tracked_free(scratch);tracked_free(out);tracked_free(times);return 1;}

static void print_error_json(const Error *err){printf("{\"ok\":false,\"error_code\":\"");const char *p=err->code;while(*p){if(*p=='\"'||*p=='\\')putchar('\\');putchar(*p++);}printf("\",\"detail\":\"");p=err->detail;while(*p){if(*p=='\"'||*p=='\\')putchar('\\');if(*p=='\n'){printf("\\n");p++;continue;}putchar(*p++);}printf("\"}\n");}
static void usage(void){fprintf(stderr,"usage:\n  yutu-graph compile FLOW.yaml OUT.json\n  yutu-graph validate MANIFEST.json\n  yutu-graph review-loop INPUT_DIR RECEIPT.json\n  yutu-graph shadow SNAPSHOT.json RETAINED_LOG_ROOT\n  yutu-graph bench FLOW.yaml ITERATIONS\n");}

int main(int argc,char **argv){Error err={{0},{0}};tracked_current=0;tracked_peak=0;if(argc<2){usage();return 2;}
  if(strcmp(argv[1],"compile")==0&&argc==4){Manifest m;char *out;size_t len;out=(char *)tracked_malloc(MAX_MANIFEST_BYTES+1,&err);if(out==NULL||!compile_file(argv[2],&m,out,MAX_MANIFEST_BYTES+1,&len,&err)||!atomic_write(argv[3],out,len,&err)){print_error_json(&err);tracked_free(out);return 1;}printf("{\"ok\":true,\"manifest_hash\":\"%s\",\"bytes\":%lu}\n",m.manifest_hash,(unsigned long)len);tracked_free(out);return 0;}
  if(strcmp(argv[1],"validate")==0&&argc==3){char *raw;size_t len;Manifest m;raw=read_file_limited(argv[2],MAX_MANIFEST_BYTES,&len,&err);if(raw==NULL||!parse_manifest_json(raw,&m,&err)||!validate_manifest(&m,&err)||!verify_manifest_hash(&m,&err)){print_error_json(&err);tracked_free(raw);return 1;}printf("{\"ok\":true,\"schema_version\":\"%s\",\"manifest_hash\":\"%s\"}\n",m.schema,m.manifest_hash);tracked_free(raw);return 0;}
  if(strcmp(argv[1],"review-loop")==0&&argc==4)return run_review_loop(argv[2],argv[3]);
  if(strcmp(argv[1],"shadow")==0&&argc==4)return run_shadow(argv[2],argv[3]);
  if(strcmp(argv[1],"bench")==0&&argc==4)return run_bench(argv[2],strtol(argv[3],NULL,10));
  usage();return 2;
}
