// scanner.js - Logica de leitura de QRcode via camera

const Scanner = {
  leitor: null,
  callback: null,

  // Inicializar o scanner de QRcode
  async iniciar(elementId, onSucesso) {
    this.callback = onSucesso;

    if (typeof Html5Qrcode === 'undefined') {
      console.error('Biblioteca html5-qrcode nao carregada');
      return false;
    }

    try {
      this.leitor = new Html5Qrcode(elementId);

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        console.error('Nenhuma camera encontrada');
        return false;
      }

      // Preferir camera traseira
      let cameraId = cameras[0].id;
      for (const cam of cameras) {
        if (cam.label && cam.label.toLowerCase().includes('back')) {
          cameraId = cam.id;
          break;
        }
      }

      await this.leitor.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0
        },
        (textoDecodificado) => {
          this.onLeitura(textoDecodificado);
        },
        () => {
          // Scan em andamento, sem resultado ainda
        }
      );

      return true;
    } catch (erro) {
      console.error('Erro ao iniciar scanner:', erro);
      return false;
    }
  },

  // Callback quando QRcode e lido
  onLeitura(texto) {
    // Vibrar dispositivo se suportado
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }

    // Parar scanner antes de processar
    this.parar().then(() => {
      if (this.callback) {
        this.callback(texto.trim());
      }
    });
  },

  // Parar o scanner
  async parar() {
    if (this.leitor) {
      try {
        const state = this.leitor.getState();
        if (state === Html5QrcodeScannerState.SCANNING) {
          await this.leitor.stop();
        }
      } catch (e) {
        // Ignorar erro ao parar
      }
    }
  },

  // Parsear QRcode de carga (formato: NUMERO_CARGA|QTD_VOLUMES)
  parsearCarga(texto) {
    if (!texto || !texto.includes('|')) {
      return null;
    }

    const partes = texto.split('|');
    if (partes.length < 2) return null;

    const numeroCarga = partes[0].trim();
    const qtdVolumes = parseInt(partes[1].trim(), 10);

    if (!numeroCarga || isNaN(qtdVolumes) || qtdVolumes <= 0) {
      return null;
    }

    return {
      numero_carga: numeroCarga,
      qtd_volumes: qtdVolumes
    };
  }
};
