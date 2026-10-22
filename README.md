# 🚚 Gomex Frota · Check-list de Veículos & SaaS de Controle

Sistema completo de vistoria e controle de frotas da **Gomex Distribuidora**, otimizado para celulares (iPhone Safari e Android Chrome), com banco de dados **Supabase**, coleta de assinaturas em tela cheia na horizontal, gerador de PDF oficial idêntico ao modelo impresso da empresa e **Painel SaaS para gestão de vistorias**.

---

## 🚀 Principais Melhorias Implementadas

1. **Correção de Desempenho e Bugs no iPhone (Safari / iOS)**:
   - Removida qualquer dependência de `google.script.run` que causava crash/tela branca no Safari.
   - Ajuste de viewport com `viewport-fit=cover` e tipografia em `16px` para evitar zoom indesejado ao tocar em campos.
   - Otimização do consumo de memória RAM do Canvas e manipulação de SVG sem recarregar a página.
   - Tratamento de exceções no `localStorage` para navegação anônima no iOS.

2. **Assinatura Digital em Modo Horizontal (Paisagem)**:
   - Modal em tela cheia dedicado com alta resolução e sensibilidade suave ao toque do dedo (PointerEvents).
   - Detecção automática de rotação com aviso visual: *"Gire o celular para a horizontal para assinar com mais conforto"*.
   - Botões de *Limpar*, *Cancelar* e *Salvar*, com pré-visualização imediata no formulário.

3. **Banco de Dados Supabase Conectado**:
   - Conexão configurada diretamente com o projeto Supabase da Gomex (`https://lhjeodmnqwsftifdvaru.supabase.co`).
   - Tabela `veiculo_checklists` com campos estruturados para identificação, pneus, avarias, itens checados, observações e assinaturas.
   - Fallback de cache local automático caso o vistoriador esteja sem conexão no momento do preenchimento.

4. **Gerador de PDF Oficial Idêntico à Folha Impressa**:
   - Desenho vetorial em escala milimétrica exata para folhas A4.
   - Logo oficial da Gomex, numeração de controle (Nº), tabelas com bordas limpas e cabeçalhos em roxo corporativo (`#302a6e`).
   - Diagrama de avarias com os marcadores reais inseridos pelo vistoriador no desenho da van.
   - 3 campos de assinatura com as imagens reais capturadas na tela.
   - Opções de **Baixar PDF** e **Imprimir Documento**.

5. **Painel SaaS de Controle de Frota**:
   - Aba dedicada com métricas em tempo real: Total de Vistorias, Veículos Liberados, Com Ressalva e Bloqueados.
   - Filtros instantâneos por placa, motorista, tipo de veículo e status de liberação.
   - Botão para **reimprimir o PDF oficial de qualquer vistoria** do histórico a qualquer momento.

---

## 🗄️ Ativação do Banco no Supabase (1 Minuto)

Para criar a tabela no Supabase:
1. Acesse o painel do seu Supabase: **[supabase.com/dashboard](https://supabase.com/dashboard)**
2. Selecione o projeto da Gomex (`lhjeodmnqwsftifdvaru`).
3. No menu lateral esquerdo, clique em **SQL Editor** (ícone `>_`) e depois em **New Query**.
4. Copie o conteúdo do arquivo [`schema.sql`](file:///C:/Users/Desktop/.gemini/antigravity-ide/scratch/gomex-checklist/schema.sql) (ou clique em "Copiar Script SQL" na aba *Banco de Dados* do app).
5. Cole e clique em **Run** (Executar).

Pronto! A tabela `veiculo_checklists` estará pronta e sincronizando em tempo real com todos os celulares.
