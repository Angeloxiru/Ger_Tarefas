// ui.js - Modal de confirmacao customizado (substitui window.confirm)

const UI = {
  confirmar(mensagem, titulo) {
    return new Promise(resolve => {
      const overlay = document.getElementById('modal-confirmar');
      document.getElementById('modal-confirmar-titulo').textContent = titulo || 'Confirmar';
      document.getElementById('modal-confirmar-msg').textContent = mensagem;
      overlay.classList.add('visivel');

      const btnSim = document.getElementById('modal-confirmar-sim');
      const btnNao = document.getElementById('modal-confirmar-nao');

      const fechar = (resultado) => {
        overlay.classList.remove('visivel');
        btnSim.removeEventListener('click', onSim);
        btnNao.removeEventListener('click', onNao);
        resolve(resultado);
      };

      const onSim = () => fechar(true);
      const onNao = () => fechar(false);

      btnSim.addEventListener('click', onSim);
      btnNao.addEventListener('click', onNao);
    });
  }
};
