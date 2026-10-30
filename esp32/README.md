# Aparelho de checklist (ESP32-2432S028R "tela amarela")
- Compilar: `pio run -e cyd_ili9341` (1 USB) ou `pio run -e cyd_st7789` (2 USB).
- Binário único para o instalador web: `esptool.py --chip esp32 merge_bin -o ../aparelho/bfit-<env>.bin --flash_mode dio --flash_freq 40m --flash_size 4MB 0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 firmware.bin`
- Instalar pelo navegador: https://equipe.bfitacademias.com.br/aparelho/
- Backend: `supabase/009_kiosk.sql` (RPCs `kiosk_*`, PIN com bcrypt, token do aparelho em SHA-256, sessão de 3 min).
- Telas simuladas: `python3 tools/simular_telas.py` → `telas/`.
- A placa só tem a chave publicável + token do aparelho (salvo na NVS). Nenhuma service key.
