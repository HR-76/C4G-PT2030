-- Keywords configuraveis para matching entre areas e oportunidades
ALTER TABLE research_areas
  ADD COLUMN IF NOT EXISTS keywords TEXT;

UPDATE research_areas
SET keywords = CASE name
  WHEN 'Agricultura de Precisão' THEN 'agriculture, agricultural, farm, farming, precision agriculture, rural, crop, soil'
  WHEN 'Alterações Climáticas' THEN 'climate, climatic, adaptation, mitigation, resilience, carbon, decarbonisation'
  WHEN 'Biotecnologia' THEN 'biotechnology, biotech, biology, biological, genomics, bio-based, bioeconomy'
  WHEN 'Blue Economy e Oceanos' THEN 'ocean, oceans, marine, maritime, sea, blue economy, aquaculture, water'
  WHEN 'Cibersegurança' THEN 'cybersecurity, cyber security, cyber, threat, encryption, privacy'
  WHEN 'Cidades Inteligentes' THEN 'smart city, smart cities, urban, cities, city, neighbourhood, mobility hub'
  WHEN 'Ciência de Dados e Big Data' THEN 'data, big data, analytics, machine learning, artificial intelligence, ai, dataset'
  WHEN 'Computação em Nuvem' THEN 'cloud, edge computing, computing infrastructure, data centre, data center'
  WHEN 'Cultura e Património Digital' THEN 'culture, cultural, heritage, creative, museum, digital heritage'
  WHEN 'Defesa e Segurança' THEN 'defence, defense, security, terrorism, border, threat, crime, resilience'
  WHEN 'Economia Circular' THEN 'circular, recycling, reuse, waste, life cycle, circular economy'
  WHEN 'Educação e Formação Profissional' THEN 'education, training, skills, learning, vocational, students, school'
  WHEN 'Eficiência Energética' THEN 'energy efficiency, efficient energy, building efficiency, renovation, heating, cooling'
  WHEN 'Empreendedorismo e Inovação' THEN 'entrepreneurship, startup, sme, small business, innovation ecosystem, innovative sme'
  WHEN 'Energias Renováveis' THEN 'renewable, solar, wind, hydrogen, photovoltaic, energy storage'
  WHEN 'Engenharia Biomédica' THEN 'biomedical, medical device, health technology, clinical, diagnostic'
  WHEN 'Espaço e Satélites' THEN 'space, satellite, earth observation, galileo, copernicus, aerospace'
  WHEN 'FinTech e Economia Digital' THEN 'fintech, digital economy, finance, financial, payment, blockchain'
  WHEN 'Fotónica e Eletrónica' THEN 'photonics, electronics, semiconductor, microelectronics, quantum, optical'
  WHEN 'Inclusão Social e Emprego' THEN 'social inclusion, employment, labour, labor, citizens, values, equality'
  WHEN 'Indústria 4.0 e Manufatura Avançada' THEN 'industry 4.0, manufacturing, factory, industrial, production, advanced manufacturing'
  WHEN 'Inteligência Artificial' THEN 'artificial intelligence, ai, machine learning, deep learning, nlp, algorithm'
  WHEN 'Internet das Coisas (IoT)' THEN 'iot, internet of things, sensors, connected devices, embedded'
  WHEN 'Materiais Avançados' THEN 'advanced materials, materials, battery materials, graphite, composite'
  WHEN 'Mobilidade Sustentável' THEN 'mobility, transport, vehicle, rail, aviation, ccam, passenger, freight'
  WHEN 'Nanotecnologia e Materiais Funcionais' THEN 'nanotechnology, nano, functional materials, nanomaterials'
  WHEN 'Robótica e Automação' THEN 'robotics, robot, automation, autonomous, automated'
  WHEN 'Saúde Digital e eHealth' THEN 'health, digital health, ehealth, medical, patient, healthcare'
  WHEN 'Sustentabilidade Ambiental' THEN 'environment, environmental, sustainability, biodiversity, pollution, ecosystem'
  WHEN 'Turismo Sustentável' THEN 'tourism, tourist, hospitality, destination, sustainable tourism'
  ELSE keywords
END
WHERE keywords IS NULL OR keywords = '';

