-- Seed idempotente das areas de investigacao base usadas no perfil e matching.
ALTER TABLE research_areas
  ADD COLUMN IF NOT EXISTS keywords TEXT;

INSERT INTO research_areas (name, keywords)
VALUES
  ('Agricultura de Precisão', 'agriculture, agricultural, farm, farming, precision agriculture, rural, crop, soil'),
  ('Alterações Climáticas', 'climate, climatic, adaptation, mitigation, resilience, carbon, decarbonisation'),
  ('Biotecnologia', 'biotechnology, biotech, biology, biological, genomics, bio-based, bioeconomy'),
  ('Blue Economy e Oceanos', 'ocean, oceans, marine, maritime, sea, blue economy, aquaculture, water'),
  ('Cibersegurança', 'cybersecurity, cyber security, cyber, threat, encryption, privacy'),
  ('Cidades Inteligentes', 'smart city, smart cities, urban, cities, city, neighbourhood, mobility hub'),
  ('Ciência de Dados e Big Data', 'data, big data, analytics, machine learning, artificial intelligence, ai, dataset'),
  ('Computação em Nuvem', 'cloud, edge computing, computing infrastructure, data centre, data center'),
  ('Cultura e Património Digital', 'culture, cultural, heritage, creative, museum, digital heritage'),
  ('Defesa e Segurança', 'defence, defense, security, terrorism, border, threat, crime, resilience'),
  ('Economia Circular', 'circular, recycling, reuse, waste, life cycle, circular economy'),
  ('Educação e Formação Profissional', 'education, training, skills, learning, vocational, students, school'),
  ('Eficiência Energética', 'energy efficiency, efficient energy, building efficiency, renovation, heating, cooling'),
  ('Empreendedorismo e Inovação', 'entrepreneurship, startup, sme, small business, innovation ecosystem, innovative sme'),
  ('Energias Renováveis', 'renewable, solar, wind, hydrogen, photovoltaic, energy storage'),
  ('Engenharia Biomédica', 'biomedical, medical device, health technology, clinical, diagnostic'),
  ('Espaço e Satélites', 'space, satellite, earth observation, galileo, copernicus, aerospace'),
  ('FinTech e Economia Digital', 'fintech, digital economy, finance, financial, payment, blockchain'),
  ('Fotónica e Eletrónica', 'photonics, electronics, semiconductor, microelectronics, quantum, optical'),
  ('Inclusão Social e Emprego', 'social inclusion, employment, labour, labor, citizens, values, equality'),
  ('Indústria 4.0 e Manufatura Avançada', 'industry 4.0, manufacturing, factory, industrial, production, advanced manufacturing'),
  ('Inteligência Artificial', 'artificial intelligence, ai, machine learning, deep learning, nlp, algorithm'),
  ('Internet das Coisas (IoT)', 'iot, internet of things, sensors, connected devices, embedded'),
  ('Materiais Avançados', 'advanced materials, materials, battery materials, graphite, composite'),
  ('Mobilidade Sustentável', 'mobility, transport, vehicle, rail, aviation, ccam, passenger, freight'),
  ('Nanotecnologia e Materiais Funcionais', 'nanotechnology, nano, functional materials, nanomaterials'),
  ('Robótica e Automação', 'robotics, robot, automation, autonomous, automated'),
  ('Saúde Digital e eHealth', 'health, digital health, ehealth, medical, patient, healthcare'),
  ('Sustentabilidade Ambiental', 'environment, environmental, sustainability, biodiversity, pollution, ecosystem'),
  ('Turismo Sustentável', 'tourism, tourist, hospitality, destination, sustainable tourism')
ON CONFLICT (name) DO UPDATE
SET keywords = COALESCE(NULLIF(research_areas.keywords, ''), EXCLUDED.keywords);
