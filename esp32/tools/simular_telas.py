# Simula as telas do firmware (mesmas coordenadas do main.cpp) em PNG 320x240 (e 2x para leitura)
import unicodedata, os
from PIL import Image, ImageDraw, ImageFont
OUT=os.path.join(os.path.dirname(__file__),'..','telas')
R='/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'; B='/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
F={'9':ImageFont.truetype(R,17),'b9':ImageFont.truetype(B,17),'b12':ImageFont.truetype(B,23),'b18':ImageFont.truetype(B,33),'b24':ImageFont.truetype(B,45)}
BG,CARD,LINE,GOLD,SAGE,TXT,MUT,RED=(10,10,10),(28,28,28),(48,48,48),(223,166,36),(139,164,128),(255,255,255),(156,156,156),(226,88,64)
A={'TL':'lt','ML':'lm','MC':'mm','TR':'rt','MR':'rm','TC':'mt'}
def ascii_(s): return unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode()
class S:
  def __init__(s): s.im=Image.new('RGB',(320,240),BG); s.d=ImageDraw.Draw(s.im)
  def txt(s,t,x,y,f,c,dat='TL'): s.d.text((x,y),ascii_(t),font=F[f],fill=c,anchor=A[dat])
  def w(s,t,f): return s.d.textlength(ascii_(t),font=F[f])
  def quebra(s,t,w,f,maxl):
    L=[];cur='';ws=ascii_(t).split(' ');i=0
    for i,p in enumerate(ws):
      tent=(cur+' '+p) if cur else p
      if s.w(tent,f)<=w or not cur: cur=tent
      else:
        L.append(cur);cur=p
        if len(L)==maxl: break
    else:
      if cur: L.append(cur); return L
    if len(L)==maxl and len(L)>0:
      u=L[-1]
      while u and s.w(u+'...',f)>w: u=u[:-1]
      L[-1]=u+'...'
    return L
  def rr(s,x,y,w,h,r,c,out=None): s.d.rounded_rectangle([x,y,x+w-1,y+h-1],r,fill=c,outline=out)
  def botao(s,x,y,w,h,t,bg=GOLD,fg=BG,f='b12'):
    s.rr(x,y,w,h,10,bg,LINE if bg==CARD else None); s.txt(t,x+w/2,y+h/2+1,f,fg,'MC')
  def cab(s,t):
    s.d.rectangle([0,0,319,33],fill=CARD); s.txt('B',10,17,'b12',GOLD,'ML'); s.txt('FIT',25,17,'b12',TXT,'ML'); s.txt(t,310,17,'9',MUT,'MR')
  def save(s,n):
    s.im.save(f'{OUT}/{n}.png'); s.im.resize((960,720),Image.NEAREST).save(f'{OUT}/{n}@3x.png')
EQ=['Júlio','Marcelly','Mayra','Thamiris','Verônica','Yasmim']
TAR=["Chegar no horário e registrar início do turno","Inspeção preventiva dos aparelhos do setor com checklist, sob supervisão (avisar defeitos na hora)","Organizar pesos, anilhas, halteres e acessórios no início e no fim do turno","Cumprimentar pelo nome e acolher os alunos que chegam no turno","Rondas no salão: observar execução e acionar o professor","Apoiar pelo menos 1 aluno novo/iniciante na adaptação ao treino","Manutenção preventiva e higienização dos equipamentos","Registrar ocorrências do turno","Conservar áreas comuns limpas e organizadas"]
def home():
  s=S();s.cab('Checklist do turno');s.txt('06:58',12,44,'b24',TXT);s.txt('Sexta, 30/10',14,86,'9',MUT);s.txt('Toque no seu nome',308,52,'9',GOLD,'TR')
  for k,n in enumerate(EQ): c,r=k%2,k//2; s.botao(8+c*154,108+r*44,148,38,n,CARD,TXT)
  s.save('01-inicio')
def pinT(n=3,err=''):
  s=S();s.cab('PIN');s.txt('Ola,',8,44,'9',MUT);s.txt('Thamiris',8,62,'b12',GOLD);s.txt('Digite seu PIN',8,196,'9',MUT);s.botao(8,208,120,28,'< Voltar',CARD,TXT,'9')
  K=["1","2","3","4","5","6","7","8","9","Apaga","0","OK"]
  for i,k in enumerate(K):
    c,r=i%3,i//3;bg=GOLD if i==11 else LINE if i==9 else CARD;fg=BG if i==11 else TXT
    s.botao(140+c*60,40+r*50,56,46,k,bg,fg,'9' if i==9 else 'b18')
  for i in range(6):
    x=16+i*20
    if i<n: s.d.ellipse([x-7,105,x+7,119],fill=GOLD)
    else: s.d.ellipse([x-7,105,x+7,119],outline=LINE)
  for i,l in enumerate(s.quebra(err,126,'9',3)) if err else []: s.txt(l,6,132+i*18,'9',RED)
  s.save('02-pin' if not err else '02b-pin-errado')
def status(st):
  s=S();s.cab('06:59');s.txt('Thamiris',12,44,'b18',GOLD)
  if st=='novo': t,d,c='Turno nao iniciado','9 tarefas hoje',TXT
  else: t,d,c='Em turno desde 07:00','Ao sair, feche o turno e marque o que fez.',SAGE
  s.txt(t,12,88,'b12',c)
  for i,l in enumerate(s.quebra(d,296,'9',2)): s.txt(l,12,118+i*20,'9',MUT)
  s.txt('Sequencia: 4 dias',12,162,'9',GOLD)
  s.botao(120,186,192,46,'Iniciar turno' if st=='novo' else 'Fechar turno'); s.botao(8,186,104,46,'Sair',CARD,TXT)
  s.save('03-status-inicio' if st=='novo' else '05-status-em-turno')
def lista(s,chk,marc,scroll=0):
  for k in range(4):
    i=scroll+k;y=38+k*40
    if i>=len(TAR): break
    s.rr(4,y+2,270,36,6,CARD);tx=12
    if chk:
      tx=44
      if marc[i]: s.rr(12,y+9,22,22,4,GOLD); s.d.line([(16,y+20),(21,y+26),(30,y+13)],fill=BG,width=3)
      else: s.d.rounded_rectangle([12,y+9,33,y+30],4,outline=MUT)
    L=s.quebra(TAR[i],270-tx-6,'9',2);y0=y+13 if len(L)==1 else y+4
    for j,l in enumerate(L): s.txt(l,tx,y0+j*16,'9',TXT)
  s.botao(280,40,36,74,'^',BG if scroll==0 else CARD,GOLD); s.botao(280,120,36,74,'v',CARD,GOLD)
def ver():
  s=S();s.cab('Turno iniciado 07:00');lista(s,False,None)
  s.rr(8,202,196,34,8,SAGE);s.txt('Guarde o celular!',106,219,'b12',BG,'MC');s.botao(212,202,100,34,'OK');s.save('04-turno-iniciado')
def marcar():
  m=[True,True,False,True,True,False,True,False,False];s=S();s.cab('Fechar turno - 3/9');lista(s,True,m)
  s.botao(8,202,100,34,'+Proativ.*',CARD,GOLD,'9');s.botao(114,202,70,34,'Voltar',CARD,TXT,'9');s.botao(190,202,122,34,'Concluir');s.save('06-fechar-turno')
def teclado():
  s=S();s.cab('Proatividade (opcional)');s.d.rectangle([4,38,315,81],fill=CARD);s.txt('Organizei a sala de spinning_',10,60,'9',TXT,'ML')
  for r,row in enumerate(["QWERTYUIOP","ASDFGHJKL","ZXCVBNM"]):
    x0=(320-len(row)*31)//2
    for i,ch in enumerate(row): s.botao(x0+i*31,88+r*37,29,34,ch,CARD,TXT,'b9')
  s.botao(4,200,70,36,'Apaga',LINE,TXT,'9');s.botao(78,200,150,36,'espaco',CARD,MUT,'9');s.botao(232,200,84,36,'OK');s.save('07-proatividade')
def confirma():
  s=S();s.cab('Confirmar');s.txt('Concluir checklist?',160,56,'b12',GOLD,'MC');s.txt('7 de 9 tarefas marcadas',160,96,'b12',TXT,'MC')
  s.txt(s.quebra('Proatividade: Organizei a sala de spinning',300,'9',1)[0],160,124,'9',SAGE,'MC');s.txt('Depois de concluir nao da para alterar.',160,152,'9',MUT,'MC')
  s.botao(8,186,120,46,'Voltar',CARD,TXT);s.botao(136,186,176,46,'Concluir');s.save('08-confirmar')
def sucesso():
  s=S();s.d.ellipse([130,22,190,82],fill=GOLD);s.d.line([(146,52),(156,63),(176,40)],fill=BG,width=5)
  s.txt('Turno fechado!',160,104,'b18',TXT,'MC');s.txt('7/9 tarefas',160,134,'9',MUT,'MC')
  s.rr(20,150,134,50,10,CARD);s.rr(166,150,134,50,10,CARD);s.txt('+85 XP',87,168,'b12',GOLD,'MC');s.txt('hoje',87,189,'9',MUT,'MC')
  s.txt('5 dias',233,168,'b12',SAGE,'MC');s.txt('sequencia',233,189,'9',MUT,'MC');s.txt('Bom descanso, Thamiris!',160,222,'9',TXT,'MC');s.save('09-sucesso')
def config():
  s=S();s.cab('Configuracao');s.txt('Configure o aparelho',160,56,'b12',GOLD,'MC')
  L=["1. No celular, conecte na rede Wi-Fi","    BFit-Checklist","2. Abra 192.168.4.1 se nao abrir sozinho","3. Configure WiFi: rede, senha e token","4. Salve. O aparelho reinicia sozinho."]
  for i,l in enumerate(L): s.txt(l,10,84+i*26,'b9' if i==1 else '9',SAGE if i==1 else TXT)
  s.save('10-configuracao-wifi')
def ajustes():
  s=S();s.cab('Ajustes');s.txt('Solte a tela e escolha:',160,56,'b12',TXT,'MC');s.botao(20,86,280,50,'Reconfigurar Wi-Fi/token',GOLD,BG,'b9')
  s.botao(20,146,280,50,'Calibrar toque',CARD,TXT,'b9');s.txt('(sem escolha em 15 s: continua)',160,218,'9',MUT,'MC');s.save('11-ajustes')
home();pinT();pinT(0,'PIN incorreto (4 tentativa(s))');status('novo');ver();status('aberto');marcar();teclado();confirma();sucesso();config();ajustes()
print(sorted(os.listdir(OUT)))
