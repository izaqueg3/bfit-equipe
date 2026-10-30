// B Fit Academias · Aparelho de checklist do turno (ESP32-2432S028R)
// Fala apenas com as RPCs kiosk_* do Supabase usando a chave publicável + token do aparelho.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <time.h>
#include <vector>
#include "root_ca.h"

#define FW_VERSAO "1.0.0"
static const char* SB_URL = "https://xrtrzhmjxmssubvwadpc.supabase.co/rest/v1/rpc/";
static const char* SB_KEY = "sb_publishable_FTPunJj10iYCdEUuSk4ePQ_SqfBKzMH"; // chave pública (não é service key)
static const char* AP_NOME = "BFit-Checklist";
static const uint32_t INATIVIDADE_MS = 60000;

// Touch (barramento SPI separado no CYD)
#define T_IRQ 36
#define T_MOSI 32
#define T_MISO 39
#define T_CLK 25
#define T_CS 33

TFT_eSPI tft;
SPIClass tsSPI(VSPI);
XPT2046_Touchscreen ts(T_CS, T_IRQ);
Preferences prefs;

// Cores B Fit
#define C_BG 0x0841      // #0a0a0a
#define C_CARD 0x18E3    // #1c1c1c
#define C_LINE 0x3186
#define C_GOLD 0xDD24    // #DFA624
#define C_SAGE 0x8D30    // #8BA480
#define C_TXT 0xFFFF
#define C_MUT 0x9CF3
#define C_RED 0xE2C8

// ---------- estado ----------
enum Tela { T_HOME, T_PIN, T_STATUS, T_VER, T_MARCAR, T_TECLADO, T_CONFIRMA, T_SUCESSO, T_MSG };
Tela tela = T_HOME;
struct Pessoa { String id, nome; bool temPin; };
struct Tarefa { String id, t; int xp; bool ok; };
std::vector<Pessoa> equipe;
std::vector<Tarefa> tarefas;
std::vector<bool> marcadas;
int sel = -1, pagHome = 0, scroll = 0;
String pin, sessao, token, erroPin, proativa, msgTitulo, msgTexto;
String stStatus, stAberto, stFechado, stNome; int stFeitas = 0, stTotal = 0, stXp = 0, stSeq = 0;
uint32_t ultimoToque = 0, ultimaEquipe = 0, ultimoRelogio = 0;
int calX0 = 300, calX1 = 3800, calY0 = 300, calY1 = 3800;  // calibração padrão
bool tocando = false;

struct Btn { int x, y, w, h, id; };
std::vector<Btn> btns;

// ---------- texto (fontes GFX são ASCII: translitera acentos) ----------
String ascii(const String& s) {
  String o; o.reserve(s.length());
  for (size_t i = 0; i < s.length(); i++) {
    uint8_t c = s[i];
    if (c < 0x80) { o += (char)c; continue; }
    if (c == 0xC3 && i + 1 < s.length()) {
      uint8_t d = s[++i]; char r = '?';
      if (d >= 0x80 && d <= 0x85) r = 'A'; else if (d == 0x87) r = 'C'; else if (d >= 0x88 && d <= 0x8B) r = 'E';
      else if (d >= 0x8C && d <= 0x8F) r = 'I'; else if (d == 0x91) r = 'N'; else if (d >= 0x92 && d <= 0x96) r = 'O';
      else if (d >= 0x99 && d <= 0x9C) r = 'U'; else if (d >= 0xA0 && d <= 0xA5) r = 'a'; else if (d == 0xA7) r = 'c';
      else if (d >= 0xA8 && d <= 0xAB) r = 'e'; else if (d >= 0xAC && d <= 0xAF) r = 'i'; else if (d == 0xB1) r = 'n';
      else if (d >= 0xB2 && d <= 0xB6) r = 'o'; else if (d >= 0xB9 && d <= 0xBC) r = 'u';
      o += r; continue;
    }
    if (c == 0xC2 && i + 1 < s.length()) { uint8_t d = s[++i]; if (d == 0xBA) o += 'o'; else if (d == 0xAA) o += 'a'; else if (d == 0xB7) o += '-'; continue; }
    if (c == 0xE2 && i + 2 < s.length()) { uint8_t d = s[i + 2]; i += 2; o += (d == 0x93 || d == 0x94) ? '-' : (d == 0x9C || d == 0x9D) ? '"' : (d == 0x98 || d == 0x99) ? '\'' : ' '; continue; }
    // outros bytes multibyte: ignora
    if (c >= 0xF0) i += 3; else if (c >= 0xE0) i += 2; else if (c >= 0xC0) i += 1;
  }
  return o;
}
void fonte(const GFXfont* f) { tft.setFreeFont(f); }
void txt(const String& s, int x, int y, const GFXfont* f, uint16_t c, uint8_t datum = TL_DATUM, uint16_t bg = 0xFFFF) {
  fonte(f); tft.setTextDatum(datum); if (bg == 0xFFFF) tft.setTextColor(c); else tft.setTextColor(c, bg); tft.drawString(ascii(s), x, y);
}
// quebra em até maxL linhas dentro de largura w
std::vector<String> quebra(const String& s0, int w, const GFXfont* f, int maxL) {
  fonte(f); String s = ascii(s0); std::vector<String> L; String cur;
  int i = 0;
  while (i <= (int)s.length()) {
    int j = s.indexOf(' ', i); if (j < 0) j = s.length();
    String pal = s.substring(i, j); String tent = cur.length() ? cur + " " + pal : pal;
    if (tft.textWidth(tent) <= w || !cur.length()) cur = tent;
    else { L.push_back(cur); cur = pal; if ((int)L.size() == maxL) break; }
    i = j + 1;
  }
  if ((int)L.size() < maxL && cur.length()) L.push_back(cur);
  else if ((int)L.size() == maxL && i <= (int)s.length()) { String& u = L.back(); while (u.length() && tft.textWidth(u + "...") > w) u.remove(u.length() - 1); u += "..."; }
  return L;
}
void botao(int x, int y, int w, int h, const String& t, int id, uint16_t bg = C_GOLD, uint16_t fg = C_BG, const GFXfont* f = &FreeSansBold12pt7b) {
  tft.fillRoundRect(x, y, w, h, 10, bg);
  if (bg == C_CARD) tft.drawRoundRect(x, y, w, h, 10, C_LINE);
  txt(t, x + w / 2, y + h / 2 + 1, f, fg, MC_DATUM);
  btns.push_back({x, y, w, h, id});
}
void limpa() { btns.clear(); tft.fillScreen(C_BG); }
void cabecalho(const String& titulo) {
  tft.fillRect(0, 0, 320, 34, C_CARD);
  txt("B", 10, 17, &FreeSansBold12pt7b, C_GOLD, ML_DATUM); txt("FIT", 25, 17, &FreeSansBold12pt7b, C_TXT, ML_DATUM);
  txt(titulo, 310, 17, &FreeSans9pt7b, C_MUT, MR_DATUM);
}
String hora(bool seg = false) {
  struct tm t; if (!getLocalTime(&t, 10)) return "--:--";
  char b[12]; strftime(b, sizeof b, seg ? "%H:%M:%S" : "%H:%M", &t); return b;
}
String dataHoje() {
  static const char* D[] = {"Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"};
  struct tm t; if (!getLocalTime(&t, 10)) return "";
  char b[32]; snprintf(b, sizeof b, "%s, %02d/%02d", D[t.tm_wday], t.tm_mday, t.tm_mon + 1); return b;
}

// ---------- API ----------
int api(const char* fn, JsonDocument& body, JsonDocument& out, String& err) {
  if (WiFi.status() != WL_CONNECTED) { err = "Sem Wi-Fi"; return -1; }
  WiFiClientSecure cli; cli.setCACert(ROOT_CA); cli.setTimeout(12);
  HTTPClient http; http.setTimeout(12000);
  if (!http.begin(cli, String(SB_URL) + fn)) { err = "Falha de conexao"; return -1; }
  http.addHeader("apikey", SB_KEY); http.addHeader("Content-Type", "application/json");
  body["dev"] = token;
  String b; serializeJson(body, b);
  int code = http.POST(b); String r = http.getString(); http.end();
  if (code <= 0) { err = "Sem conexao com o servidor"; return code; }
  out.clear();
  if (r.length()) deserializeJson(out, r);
  if (code >= 300) { { String m = out["message"] | String(""); err = m.length() ? m : String("Erro ") + String(code); } return code; }
  return code;
}
bool erroDeSessao(const String& e) { return e.indexOf("Sess") >= 0 || e.indexOf("inativo") >= 0; }
bool erroDeAparelho(const String& e) { return e.indexOf("Aparelho n") >= 0; }

void mostraMsg(const String& t, const String& m);
void desenha();
void irHome();

bool carregaEquipe() {
  JsonDocument b, o; String e;
  if (api("kiosk_team", b, o, e) != 200) { if (erroDeAparelho(e)) mostraMsg("Aparelho bloqueado", "Token invalido ou revogado. Desligue, segure a tela ao ligar e informe um novo token."); return false; }
  equipe.clear();
  for (JsonObject p : o.as<JsonArray>()) equipe.push_back({p["id"].as<String>(), p["nome"].as<String>(), p["tem_pin"] | false});
  ultimaEquipe = millis(); return true;
}
void lerEstado(JsonDocument& o) {
  stNome = o["nome"].as<String>(); stStatus = o["status"].as<String>();
  stAberto = o["aberto"] | ""; stFechado = o["fechado"] | "";
  stFeitas = o["feitas"] | 0; stTotal = o["total"] | 0; stXp = o["xp_dia"] | 0; stSeq = o["sequencia"] | 0;
  tarefas.clear();
  for (JsonObject t : o["tarefas"].as<JsonArray>()) tarefas.push_back({t["id"].as<String>(), t["t"].as<String>(), t["xp"] | 0, t["ok"] | false});
}
bool chama(const char* fn, JsonDocument& b) {
  JsonDocument o; String e; b["sess"] = sessao;
  tft.fillRect(0, 206, 320, 34, C_BG); txt("Aguarde...", 160, 222, &FreeSans9pt7b, C_MUT, MC_DATUM);
  if (api(fn, b, o, e) != 200) {
    if (erroDeSessao(e)) { irHome(); return false; }
    mostraMsg("Nao foi possivel", e); return false;
  }
  lerEstado(o); return true;
}

// ---------- telas ----------
void telaHome() {
  limpa(); cabecalho("Checklist do turno");
  txt(hora(), 12, 44, &FreeSansBold24pt7b, C_TXT); txt(dataHoje(), 14, 86, &FreeSans9pt7b, C_MUT);
  txt("Toque no seu nome", 308, 52, &FreeSans9pt7b, C_GOLD, TR_DATUM);
  int n = equipe.size(), porPag = 6, pags = max(1, (n + porPag - 1) / porPag); if (pagHome >= pags) pagHome = 0;
  for (int k = 0; k < porPag; k++) {
    int i = pagHome * porPag + k; if (i >= n) break;
    int c = k % 2, r = k / 2;
    botao(8 + c * 154, 108 + r * 44, 148, 38, equipe[i].nome, 100 + i, C_CARD, C_TXT, &FreeSansBold12pt7b);
  }
  if (pags > 1) botao(250, 76, 62, 26, "mais >", 90, C_CARD, C_GOLD, &FreeSans9pt7b);
  if (!n) txt("Carregando equipe...", 160, 170, &FreeSans9pt7b, C_MUT, MC_DATUM);
}
void desenhaPinPontos() {
  tft.fillRect(0, 90, 134, 80, C_BG);
  for (int i = 0; i < 6; i++) { int x = 16 + i * 20; if (i < (int)pin.length()) tft.fillCircle(x, 112, 7, C_GOLD); else tft.drawCircle(x, 112, 7, C_LINE); }
  if (erroPin.length()) { auto L = quebra(erroPin, 126, &FreeSans9pt7b, 3); for (size_t i = 0; i < L.size(); i++) txt(L[i], 6, 132 + i * 18, &FreeSans9pt7b, C_RED); }
}
void telaPin() {
  limpa(); cabecalho("PIN");
  txt("Ola,", 8, 44, &FreeSans9pt7b, C_MUT); txt(equipe[sel].nome, 8, 62, &FreeSansBold12pt7b, C_GOLD);
  txt("Digite seu PIN", 8, 196, &FreeSans9pt7b, C_MUT);
  botao(8, 208, 120, 28, "< Voltar", 1, C_CARD, C_TXT, &FreeSans9pt7b);
  const char* K[] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "Apaga", "0", "OK"};
  for (int i = 0; i < 12; i++) {
    int c = i % 3, r = i / 3; uint16_t bg = i == 11 ? C_GOLD : i == 9 ? C_LINE : C_CARD, fg = i == 11 ? C_BG : C_TXT;
    botao(140 + c * 60, 40 + r * 50, 56, 46, K[i], i == 9 ? 20 : i == 11 ? 21 : 10 + (i == 10 ? 0 : i + 1), bg, fg, i == 9 ? &FreeSans9pt7b : &FreeSansBold18pt7b);
  }
  desenhaPinPontos();
}
void telaStatus() {
  limpa(); cabecalho(hora());
  txt(stNome, 12, 44, &FreeSansBold18pt7b, C_GOLD);
  String s, d; uint16_t cor = C_TXT;
  if (stStatus == "novo") { s = "Turno nao iniciado"; d = String(stTotal) + " tarefas hoje"; }
  else if (stStatus == "aberto") { s = "Em turno desde " + stAberto; d = "Ao sair, feche o turno e marque o que fez."; cor = C_SAGE; }
  else { s = "Checklist concluido"; d = "Fechado as " + stFechado + " - " + stFeitas + "/" + stTotal + " tarefas - " + stXp + " XP"; cor = C_SAGE; }
  txt(s, 12, 88, &FreeSansBold12pt7b, cor);
  auto L = quebra(d, 296, &FreeSans9pt7b, 2); for (size_t i = 0; i < L.size(); i++) txt(L[i], 12, 118 + i * 20, &FreeSans9pt7b, C_MUT);
  txt("Sequencia: " + String(stSeq) + (stSeq == 1 ? " dia" : " dias"), 12, 162, &FreeSans9pt7b, C_GOLD);
  if (stStatus == "novo") botao(120, 186, 192, 46, "Iniciar turno", 2);
  else if (stStatus == "aberto") botao(120, 186, 192, 46, "Fechar turno", 3);
  else botao(120, 186, 192, 46, "Ver tarefas", 4, C_CARD, C_TXT);
  botao(8, 186, 104, 46, "Sair", 1, C_CARD, C_TXT);
}
const int LIST_Y = 38, ROW_H = 40, ROWS = 4;
void lista(bool comCheck) {
  tft.fillRect(0, LIST_Y, 320, ROW_H * ROWS, C_BG);
  btns.erase(std::remove_if(btns.begin(), btns.end(), [](const Btn& b) { return b.id >= 200; }), btns.end());
  int n = tarefas.size();
  for (int k = 0; k < ROWS; k++) {
    int i = scroll + k; if (i >= n) break; int y = LIST_Y + k * ROW_H;
    bool on = comCheck ? (bool)marcadas[i] : tarefas[i].ok;
    tft.fillRoundRect(4, y + 2, 270, ROW_H - 4, 6, C_CARD);
    int tx = 12;
    if (comCheck) { tx = 44; if (on) { tft.fillRoundRect(12, y + 9, 22, 22, 4, C_GOLD); tft.drawWideLine(16, y + 20, 21, y + 26, 3, C_BG); tft.drawWideLine(21, y + 26, 30, y + 13, 3, C_BG); } else tft.drawRoundRect(12, y + 9, 22, 22, 4, C_MUT); btns.push_back({4, y + 2, 270, ROW_H - 4, 200 + i}); }
    auto L = quebra(tarefas[i].t, 270 - tx - 6, &FreeSans9pt7b, 2);
    int y0 = L.size() == 1 ? y + 13 : y + 4;
    for (size_t j = 0; j < L.size(); j++) txt(L[j], tx, y0 + j * 16, &FreeSans9pt7b, on && comCheck ? C_TXT : C_TXT);
  }
  // barra de rolagem
  tft.fillRect(278, LIST_Y, 42, ROW_H * ROWS, C_BG);
  if (n > ROWS) {
    botao(280, LIST_Y + 2, 36, 74, "^", 30, scroll > 0 ? C_CARD : C_BG, C_GOLD, &FreeSansBold12pt7b);
    botao(280, LIST_Y + 82, 36, 74, "v", 31, scroll + ROWS < n ? C_CARD : C_BG, C_GOLD, &FreeSansBold12pt7b);
  }
}
void telaVer() {
  limpa(); cabecalho(stStatus == "fechado" ? "Tarefas de hoje" : "Turno iniciado " + stAberto);
  lista(false);
  if (stStatus == "fechado") botao(8, 202, 304, 34, "OK", 1, C_CARD, C_TXT);
  else { tft.fillRoundRect(8, 202, 196, 34, 8, C_SAGE); txt("Guarde o celular!", 106, 219, &FreeSansBold12pt7b, C_BG, MC_DATUM); botao(212, 202, 100, 34, "OK", 1); }
}
void telaMarcar() {
  limpa(); int n = 0; for (bool b : marcadas) n += b;
  cabecalho("Fechar turno - " + String(n) + "/" + String(tarefas.size()));
  lista(true);
  botao(8, 202, 100, 34, proativa.length() ? "+Proativ.*" : "+Proativ.", 5, C_CARD, C_GOLD, &FreeSans9pt7b);
  botao(114, 202, 70, 34, "Voltar", 1, C_CARD, C_TXT, &FreeSans9pt7b);
  botao(190, 202, 122, 34, "Concluir", 6);
}
const char* KB[] = {"QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"};
void desenhaCampo() {
  tft.fillRect(4, 38, 312, 44, C_CARD);
  String s = proativa; fonte(&FreeSans9pt7b); while (s.length() && tft.textWidth(s + "_") > 300) s.remove(0, 1);
  txt(proativa.length() ? s + "_" : "Ex.: organizei os halteres", 10, 60, &FreeSans9pt7b, proativa.length() ? C_TXT : C_MUT, ML_DATUM);
}
void telaTeclado() {
  limpa(); cabecalho("Proatividade (opcional)"); desenhaCampo();
  for (int r = 0; r < 3; r++) { int n = strlen(KB[r]), x0 = (320 - n * 31) / 2;
    for (int i = 0; i < n; i++) botao(x0 + i * 31, 88 + r * 37, 29, 34, String(KB[r][i]), 400 + KB[r][i], C_CARD, C_TXT, &FreeSansBold9pt7b); }
  botao(4, 200, 70, 36, "Apaga", 40, C_LINE, C_TXT, &FreeSans9pt7b);
  botao(78, 200, 150, 36, "espaco", 41, C_CARD, C_MUT, &FreeSans9pt7b);
  botao(232, 200, 84, 36, "OK", 42);
}
void telaConfirma() {
  limpa(); cabecalho("Confirmar");
  int n = 0; for (bool b : marcadas) n += b;
  txt("Concluir checklist?", 160, 56, &FreeSansBold12pt7b, C_GOLD, MC_DATUM);
  txt(String(n) + " de " + tarefas.size() + " tarefas marcadas", 160, 96, &FreeSansBold12pt7b, C_TXT, MC_DATUM);
  if (proativa.length()) { auto L = quebra("Proatividade: " + proativa, 300, &FreeSans9pt7b, 1); txt(L[0], 160, 124, &FreeSans9pt7b, C_SAGE, MC_DATUM); }
  txt("Depois de concluir nao da para alterar.", 160, 152, &FreeSans9pt7b, C_MUT, MC_DATUM);
  botao(8, 186, 120, 46, "Voltar", 7, C_CARD, C_TXT);
  botao(136, 186, 176, 46, "Concluir", 8);
}
void telaSucesso() {
  limpa();
  tft.fillCircle(160, 52, 30, C_GOLD); tft.drawWideLine(146, 52, 156, 63, 5, C_BG); tft.drawWideLine(156, 63, 176, 40, 5, C_BG);
  txt("Turno fechado!", 160, 104, &FreeSansBold18pt7b, C_TXT, MC_DATUM);
  txt(String(stFeitas) + "/" + stTotal + " tarefas", 160, 134, &FreeSans9pt7b, C_MUT, MC_DATUM);
  tft.fillRoundRect(20, 150, 134, 50, 10, C_CARD); tft.fillRoundRect(166, 150, 134, 50, 10, C_CARD);
  txt("+" + String(stXp) + " XP", 87, 168, &FreeSansBold12pt7b, C_GOLD, MC_DATUM); txt("hoje", 87, 189, &FreeSans9pt7b, C_MUT, MC_DATUM);
  txt(String(stSeq) + (stSeq == 1 ? " dia" : " dias"), 233, 168, &FreeSansBold12pt7b, C_SAGE, MC_DATUM); txt("sequencia", 233, 189, &FreeSans9pt7b, C_MUT, MC_DATUM);
  txt("Bom descanso, " + stNome + "!", 160, 222, &FreeSans9pt7b, C_TXT, MC_DATUM);
  btns.push_back({0, 0, 320, 240, 1});
}
void telaMsg() {
  limpa(); cabecalho("Aviso");
  txt(msgTitulo, 160, 60, &FreeSansBold12pt7b, C_GOLD, MC_DATUM);
  auto L = quebra(msgTexto, 296, &FreeSans9pt7b, 5); for (size_t i = 0; i < L.size(); i++) txt(L[i], 160, 92 + i * 20, &FreeSans9pt7b, C_TXT, TC_DATUM);
  botao(90, 196, 140, 38, "OK", 1, C_CARD, C_TXT);
}
void desenha() {
  switch (tela) { case T_HOME: telaHome(); break; case T_PIN: telaPin(); break; case T_STATUS: telaStatus(); break; case T_VER: telaVer(); break;
    case T_MARCAR: telaMarcar(); break; case T_TECLADO: telaTeclado(); break; case T_CONFIRMA: telaConfirma(); break; case T_SUCESSO: telaSucesso(); break; case T_MSG: telaMsg(); break; }
}
void mostraMsg(const String& t, const String& m) { msgTitulo = t; msgTexto = m; tela = T_MSG; desenha(); }
void irHome() {
  if (sessao.length()) { JsonDocument b, o; String e; b["sess"] = sessao; api("kiosk_logout", b, o, e); }
  sessao = ""; pin = ""; erroPin = ""; proativa = ""; sel = -1; tarefas.clear(); marcadas.clear(); tela = T_HOME;
  if (millis() - ultimaEquipe > 600000 || equipe.empty()) carregaEquipe();
  if (tela == T_HOME) desenha();
}

// ---------- ações ----------
void entrarPin() {
  if (pin.length() < 4) { erroPin = "PIN tem 4 a 6 numeros"; desenhaPinPontos(); return; }
  JsonDocument b, o; String e; b["pid"] = equipe[sel].id; b["pin"] = pin;
  erroPin = "Verificando..."; desenhaPinPontos();
  int c = api("kiosk_login", b, o, e); pin = "";
  if (c != 200) { erroPin = e; desenhaPinPontos(); if (erroDeAparelho(e)) mostraMsg("Aparelho bloqueado", e); return; }
  if (!(o["ok"] | false)) { erroPin = o["erro"] | "PIN incorreto"; desenhaPinPontos(); return; }
  sessao = o["sessao"].as<String>(); erroPin = "";
  JsonDocument s; if (!chama("kiosk_status", s)) return;
  tela = T_STATUS; desenha();
}
void toque(int id) {
  if (tela == T_HOME) {
    if (id == 90) { pagHome++; desenha(); }
    else if (id >= 100) { sel = id - 100; pin = ""; erroPin = equipe[sel].temPin ? "" : "Cadastre seu PIN no app: Senha e PIN"; tela = T_PIN; desenha(); }
    return;
  }
  if (id == 1) { if (tela == T_PIN || tela == T_STATUS || tela == T_SUCESSO || (tela == T_MSG && !sessao.length())) irHome();
                 else if (tela == T_MSG || tela == T_VER || tela == T_MARCAR) { if (tela == T_VER && stStatus != "fechado") irHome(); else { tela = T_STATUS; desenha(); } } return; }
  switch (tela) {
    case T_PIN:
      if (id >= 10 && id <= 19) { if (pin.length() < 6) pin += char('0' + id - 10); erroPin = ""; desenhaPinPontos(); }
      else if (id == 20) { if (pin.length()) pin.remove(pin.length() - 1); desenhaPinPontos(); }
      else if (id == 21) entrarPin();
      break;
    case T_STATUS:
      if (id == 2) { JsonDocument b; if (chama("kiosk_iniciar", b)) { scroll = 0; tela = T_VER; desenha(); } }
      else if (id == 3) { marcadas.assign(tarefas.size(), false); for (size_t i = 0; i < tarefas.size(); i++) marcadas[i] = tarefas[i].ok; scroll = 0; proativa = ""; tela = T_MARCAR; desenha(); }
      else if (id == 4) { scroll = 0; tela = T_VER; desenha(); }
      break;
    case T_VER: case T_MARCAR:
      if (id == 30 && scroll > 0) { scroll = max(0, scroll - ROWS); lista(tela == T_MARCAR); }
      else if (id == 31 && scroll + ROWS < (int)tarefas.size()) { scroll += ROWS; lista(tela == T_MARCAR); }
      else if (id >= 200 && tela == T_MARCAR) { int i = id - 200; marcadas[i] = !marcadas[i]; desenha(); }
      else if (id == 5) { tela = T_TECLADO; desenha(); }
      else if (id == 6) { tela = T_CONFIRMA; desenha(); }
      break;
    case T_TECLADO:
      if (id >= 400) { if (proativa.length() < 120) proativa += (char)(proativa.length() && proativa[proativa.length() - 1] != ' ' ? tolower(id - 400) : id - 400); desenhaCampo(); }
      else if (id == 40) { if (proativa.length()) proativa.remove(proativa.length() - 1); desenhaCampo(); }
      else if (id == 41) { if (proativa.length() && proativa[proativa.length() - 1] != ' ') proativa += ' '; desenhaCampo(); }
      else if (id == 42) { proativa.trim(); tela = T_MARCAR; desenha(); }
      break;
    case T_CONFIRMA:
      if (id == 7) { tela = T_MARCAR; desenha(); }
      else if (id == 8) {
        JsonDocument b; JsonArray a = b["tarefas"].to<JsonArray>();
        for (size_t i = 0; i < tarefas.size(); i++) if (marcadas[i]) a.add(tarefas[i].id);
        if (proativa.length()) b["proativa"] = proativa;
        if (chama("kiosk_fechar", b)) { tela = T_SUCESSO; desenha(); }
      }
      break;
    default: break;
  }
}

// ---------- touch ----------
bool lerToque(int& x, int& y) {
  if (!ts.touched()) return false;
  TS_Point p = ts.getPoint(); if (p.z < 300) return false;
  x = constrain(map(p.x, calX0, calX1, 0, 319), 0, 319); y = constrain(map(p.y, calY0, calY1, 0, 239), 0, 239); return true;
}
void cruz(int x, int y, uint16_t c) { tft.drawLine(x - 10, y, x + 10, y, c); tft.drawLine(x, y - 10, x, y + 10, c); tft.drawCircle(x, y, 4, c); }
TS_Point esperaPonto() {
  while (ts.touched()) delay(20);
  long sx = 0, sy = 0; int n = 0;
  while (n < 12) { if (ts.touched()) { TS_Point p = ts.getPoint(); if (p.z > 400) { sx += p.x; sy += p.y; n++; } } delay(15); }
  while (ts.touched()) delay(20);
  return TS_Point(sx / n, sy / n, 0);
}
void calibrar() {
  limpa(); txt("Calibrar toque", 160, 100, &FreeSansBold12pt7b, C_GOLD, MC_DATUM); txt("Toque no centro de cada cruz", 160, 130, &FreeSans9pt7b, C_TXT, MC_DATUM);
  cruz(20, 20, C_GOLD); TS_Point a = esperaPonto(); cruz(20, 20, C_BG);
  cruz(300, 220, C_GOLD); TS_Point b = esperaPonto();
  // extrapola de (20,20)-(300,220) para (0,0)-(319,239)
  float kx = (b.x - a.x) / 280.0f, ky = (b.y - a.y) / 200.0f;
  calX0 = a.x - kx * 20; calX1 = a.x + kx * 299; calY0 = a.y - ky * 20; calY1 = a.y + ky * 219;
  prefs.putInt("cx0", calX0); prefs.putInt("cx1", calX1); prefs.putInt("cy0", calY0); prefs.putInt("cy1", calY1); prefs.putBool("cal", true);
  limpa(); txt("Toque calibrado!", 160, 120, &FreeSansBold12pt7b, C_SAGE, MC_DATUM); delay(1200);
}

// ---------- Wi-Fi / configuração ----------
bool salvar = false;
void portal(bool forcar) {
  WiFiManager wm; wm.setTitle("B Fit - Aparelho de checklist"); wm.setDarkMode(true);
  WiFiManagerParameter pTok("token", "Token do aparelho (gerado em Admin &gt; Aparelhos)", "", 72, "type='password' autocomplete='off'");
  wm.addParameter(&pTok); wm.setSaveParamsCallback([]() { salvar = true; }); wm.setSaveConfigCallback([]() { salvar = true; });
  std::vector<const char*> menu = {"wifi", "exit"}; wm.setMenu(menu);
  wm.setConnectTimeout(20);
  limpa(); cabecalho("Configuracao");
  txt("Configure o aparelho", 160, 56, &FreeSansBold12pt7b, C_GOLD, MC_DATUM);
  const char* L[] = {"1. No celular, conecte na rede Wi-Fi", "    BFit-Checklist", "2. Abra 192.168.4.1 se nao abrir sozinho", "3. Configure WiFi: rede, senha e token", "4. Salve. O aparelho reinicia sozinho."};
  for (int i = 0; i < 5; i++) txt(L[i], 10, 84 + i * 26, i == 1 ? &FreeSansBold9pt7b : &FreeSans9pt7b, i == 1 ? C_SAGE : C_TXT);
  bool ok = forcar ? wm.startConfigPortal(AP_NOME) : wm.autoConnect(AP_NOME);
  String t = pTok.getValue(); t.trim();
  if (salvar && t.length() >= 20) { prefs.putString("token", t); token = t; }
  if (!ok || forcar) { delay(500); ESP.restart(); }
}
void bootMenu() {
  limpa(); cabecalho("Ajustes");
  txt("Solte a tela e escolha:", 160, 56, &FreeSansBold12pt7b, C_TXT, MC_DATUM);
  botao(20, 86, 280, 50, "Reconfigurar Wi-Fi/token", 1, C_GOLD, C_BG, &FreeSansBold9pt7b);
  botao(20, 146, 280, 50, "Calibrar toque", 2, C_CARD, C_TXT, &FreeSansBold9pt7b);
  txt("(sem escolha em 15 s: continua)", 160, 218, &FreeSans9pt7b, C_MUT, MC_DATUM);
  while (ts.touched()) delay(20);
  uint32_t t0 = millis(); int x, y;
  while (millis() - t0 < 15000) {
    if (lerToque(x, y)) { for (auto& b : btns) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
      if (b.id == 2) { calibrar(); return; }
      if (b.id == 1) { WiFiManager wm; wm.resetSettings(); prefs.remove("token"); token = ""; portal(true); } } }
    delay(30);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TFT_BL, OUTPUT); digitalWrite(TFT_BL, HIGH);
  tft.init(); tft.setRotation(1); tft.fillScreen(C_BG);
  tsSPI.begin(T_CLK, T_MISO, T_MOSI, T_CS); ts.begin(tsSPI); ts.setRotation(1);
  prefs.begin("bfit", false);
  token = prefs.getString("token", "");
  if (prefs.getBool("cal", false)) { calX0 = prefs.getInt("cx0"); calX1 = prefs.getInt("cx1"); calY0 = prefs.getInt("cy0"); calY1 = prefs.getInt("cy1"); }
  limpa(); txt("B", 118, 100, &FreeSansBold24pt7b, C_GOLD, MR_DATUM); txt("FIT", 120, 100, &FreeSansBold24pt7b, C_TXT, ML_DATUM);
  txt("Checklist do turno - v" FW_VERSAO, 160, 150, &FreeSans9pt7b, C_MUT, MC_DATUM);
  txt("Segure a tela para ajustes", 160, 200, &FreeSans9pt7b, C_MUT, MC_DATUM);
  uint32_t t0 = millis(); bool seg = false;
  while (millis() - t0 < 2500) { if (ts.touched()) { seg = true; break; } delay(20); }
  if (seg) { delay(1500); if (ts.touched()) bootMenu(); }
  if (!prefs.getBool("cal", false)) calibrar();
  WiFi.mode(WIFI_STA);
  if (!token.length()) { WiFiManager wm; wm.resetSettings(); portal(true); }
  portal(false);
  limpa(); txt("Conectado. Acertando relogio...", 160, 120, &FreeSans9pt7b, C_TXT, MC_DATUM);
  configTzTime("<-03>3", "pool.ntp.org", "time.google.com", "a.st1.ntp.br");
  struct tm t; for (int i = 0; i < 30 && !getLocalTime(&t, 500); i++) {}
  carregaEquipe();
  if (tela == T_HOME) desenha();
  ultimoToque = millis();
}

void loop() {
  int x, y;
  if (lerToque(x, y)) {
    if (!tocando) {
      tocando = true; ultimoToque = millis();
      for (auto b : btns) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { toque(b.id); break; }
    }
  } else if (!ts.touched()) tocando = false;
  uint32_t ag = millis();
  if (tela != T_HOME && ag - ultimoToque > (tela == T_SUCESSO ? 10000 : INATIVIDADE_MS)) irHome();
  if (tela == T_HOME && ag - ultimoRelogio > 1000) { ultimoRelogio = ag; tft.fillRect(10, 40, 200, 40, C_BG); txt(hora(), 12, 44, &FreeSansBold24pt7b, C_TXT); }
  if (tela == T_HOME && ag - ultimaEquipe > 600000) { if (carregaEquipe() && tela == T_HOME) desenha(); }
  if (WiFi.status() != WL_CONNECTED && tela == T_HOME && ag % 30000 < 40) WiFi.reconnect();
  delay(15);
}
