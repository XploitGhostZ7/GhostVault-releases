// By Kompilador
import { z } from 'zod';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean';

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  loinc?: string;
};

export type Section = { key: string; label: string; fields: Field[] };

export type Template = {
  code: string;
  version: number;
  nombre: string;
  especialidad: string;
  codServicioSugerido: string;
  cupsSugerido: string;
  sections: Section[];
};

const motivo: Section = {
  key: 'motivo',
  label: 'Motivo de consulta',
  fields: [
    { key: 'motivo_consulta', label: 'Motivo de consulta', type: 'textarea', required: true },
    { key: 'enfermedad_actual', label: 'Enfermedad actual', type: 'textarea', required: true },
  ],
};

const antecedentes: Section = {
  key: 'antecedentes',
  label: 'Antecedentes',
  fields: [
    { key: 'personales', label: 'Patológicos', type: 'textarea' },
    { key: 'quirurgicos', label: 'Quirúrgicos', type: 'textarea' },
    { key: 'farmacologicos', label: 'Farmacológicos', type: 'textarea' },
    { key: 'alergias', label: 'Alergias', type: 'textarea', required: true },
    { key: 'familiares', label: 'Familiares', type: 'textarea' },
    { key: 'toxicos', label: 'Tóxicos', type: 'textarea' },
  ],
};

const signosVitales: Section = {
  key: 'signos_vitales',
  label: 'Signos vitales',
  fields: [
    { key: 'ta_sistolica', label: 'TA sistólica', type: 'number', min: 40, max: 300, unit: 'mm[Hg]', loinc: '8480-6' },
    { key: 'ta_diastolica', label: 'TA diastólica', type: 'number', min: 20, max: 200, unit: 'mm[Hg]', loinc: '8462-4' },
    { key: 'fc', label: 'Frecuencia cardiaca', type: 'number', min: 20, max: 300, unit: '/min', loinc: '8867-4' },
    { key: 'fr', label: 'Frecuencia respiratoria', type: 'number', min: 4, max: 100, unit: '/min', loinc: '9279-1' },
    { key: 'temperatura', label: 'Temperatura', type: 'number', min: 30, max: 45, unit: 'Cel', loinc: '8310-5' },
    { key: 'spo2', label: 'Saturación O2', type: 'number', min: 40, max: 100, unit: '%', loinc: '59408-5' },
    { key: 'peso', label: 'Peso', type: 'number', min: 0.3, max: 400, unit: 'kg', loinc: '29463-7' },
    { key: 'talla', label: 'Talla', type: 'number', min: 20, max: 250, unit: 'cm', loinc: '8302-2' },
  ],
};

const revisionExamen: Section[] = [
  {
    key: 'revision_sistemas',
    label: 'Revisión por sistemas',
    fields: [{ key: 'hallazgos', label: 'Hallazgos', type: 'textarea' }],
  },
  {
    key: 'examen_fisico',
    label: 'Examen físico',
    fields: [
      { key: 'estado_general', label: 'Estado general', type: 'textarea', required: true },
      { key: 'hallazgos', label: 'Hallazgos por sistemas', type: 'textarea', required: true },
    ],
  },
];

const analisisPlan: Section = {
  key: 'analisis_plan',
  label: 'Análisis y plan',
  fields: [
    { key: 'analisis', label: 'Análisis', type: 'textarea', required: true },
    { key: 'plan', label: 'Plan de manejo', type: 'textarea', required: true },
    { key: 'recomendaciones', label: 'Recomendaciones y signos de alarma', type: 'textarea' },
  ],
};

export const TEMPLATES: Template[] = [
  {
    code: 'medicina_general',
    version: 1,
    nombre: 'Consulta de medicina general',
    especialidad: 'Medicina general',
    codServicioSugerido: '328',
    cupsSugerido: '890201',
    sections: [motivo, antecedentes, signosVitales, ...revisionExamen, analisisPlan],
  },
  {
    code: 'pediatria',
    version: 1,
    nombre: 'Consulta de pediatría',
    especialidad: 'Pediatría',
    codServicioSugerido: '342',
    cupsSugerido: '890283',
    sections: [
      motivo,
      {
        key: 'perinatales',
        label: 'Antecedentes perinatales',
        fields: [
          { key: 'edad_gestacional', label: 'Edad gestacional al nacer (semanas)', type: 'number', min: 20, max: 45 },
          { key: 'peso_nacer', label: 'Peso al nacer (g)', type: 'number', min: 300, max: 7000 },
          { key: 'tipo_parto', label: 'Tipo de parto', type: 'select', options: ['vaginal', 'cesarea'] },
          { key: 'complicaciones', label: 'Complicaciones neonatales', type: 'textarea' },
        ],
      },
      antecedentes,
      {
        key: 'crecimiento_desarrollo',
        label: 'Crecimiento y desarrollo',
        fields: [
          { key: 'perimetro_cefalico', label: 'Perímetro cefálico', type: 'number', min: 20, max: 70, unit: 'cm', loinc: '9843-4' },
          { key: 'desarrollo', label: 'Hitos del desarrollo', type: 'textarea' },
          { key: 'alimentacion', label: 'Alimentación', type: 'textarea' },
          { key: 'vacunacion_completa', label: 'Esquema PAI completo para la edad', type: 'boolean', required: true },
          { key: 'vacunas_pendientes', label: 'Vacunas pendientes', type: 'text' },
        ],
      },
      signosVitales,
      ...revisionExamen,
      analisisPlan,
    ],
  },
  {
    code: 'ginecologia',
    version: 1,
    nombre: 'Consulta de ginecología',
    especialidad: 'Ginecología y obstetricia',
    codServicioSugerido: '320',
    cupsSugerido: '890250',
    sections: [
      motivo,
      {
        key: 'gineco_obstetricos',
        label: 'Antecedentes gineco-obstétricos',
        fields: [
          { key: 'menarquia', label: 'Menarquia (edad)', type: 'number', min: 7, max: 20 },
          { key: 'fum', label: 'Fecha de última menstruación', type: 'date' },
          { key: 'ciclos', label: 'Ciclos', type: 'text' },
          { key: 'gestaciones', label: 'Gestaciones', type: 'number', min: 0, max: 30, required: true },
          { key: 'partos', label: 'Partos', type: 'number', min: 0, max: 30 },
          { key: 'cesareas', label: 'Cesáreas', type: 'number', min: 0, max: 30 },
          { key: 'abortos', label: 'Abortos', type: 'number', min: 0, max: 30 },
          { key: 'planificacion', label: 'Método de planificación', type: 'text' },
          { key: 'citologia_ultima', label: 'Última citología', type: 'date' },
          { key: 'citologia_resultado', label: 'Resultado de citología', type: 'text' },
        ],
      },
      antecedentes,
      signosVitales,
      ...revisionExamen,
      analisisPlan,
    ],
  },
  {
    code: 'psicologia',
    version: 1,
    nombre: 'Consulta de psicología',
    especialidad: 'Psicología',
    codServicioSugerido: '344',
    cupsSugerido: '890208',
    sections: [
      motivo,
      {
        key: 'historia_personal',
        label: 'Historia personal y familiar',
        fields: [
          { key: 'dinamica_familiar', label: 'Dinámica familiar', type: 'textarea' },
          { key: 'historia_escolar_laboral', label: 'Historia escolar y laboral', type: 'textarea' },
          { key: 'consumo_sustancias', label: 'Consumo de sustancias', type: 'textarea' },
          { key: 'antecedentes_psiquiatricos', label: 'Antecedentes psiquiátricos', type: 'textarea' },
        ],
      },
      {
        key: 'examen_mental',
        label: 'Examen mental',
        fields: [
          { key: 'apariencia', label: 'Apariencia y conducta', type: 'textarea', required: true },
          { key: 'afecto', label: 'Afecto', type: 'text', required: true },
          { key: 'pensamiento', label: 'Pensamiento', type: 'textarea', required: true },
          { key: 'sensopercepcion', label: 'Sensopercepción', type: 'text' },
          { key: 'orientacion', label: 'Orientación', type: 'text' },
          { key: 'juicio_introspeccion', label: 'Juicio e introspección', type: 'text' },
          { key: 'riesgo_suicida', label: 'Riesgo suicida', type: 'select', options: ['sin_riesgo', 'bajo', 'moderado', 'alto'], required: true },
        ],
      },
      {
        key: 'analisis_plan',
        label: 'Impresión y plan de intervención',
        fields: [
          { key: 'analisis', label: 'Impresión clínica', type: 'textarea', required: true },
          { key: 'plan', label: 'Plan de intervención', type: 'textarea', required: true },
          { key: 'recomendaciones', label: 'Acuerdos y tareas', type: 'textarea' },
        ],
      },
    ],
  },
];

export function getTemplate(code: string, version?: number): Template | undefined {
  return TEMPLATES.find((t) => t.code === code && (version === undefined || t.version === version));
}

function fieldSchema(f: Field, strict: boolean): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (f.type) {
    case 'number': {
      let n = z.number();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      s = n;
      break;
    }
    case 'date':
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'select':
      s = z.enum(f.options as [string, ...string[]]);
      break;
    case 'text':
      s = z.string().max(500);
      break;
    default:
      s = z.string().max(20000);
  }
  if (strict && f.required) {
    return f.type === 'text' || f.type === 'textarea' ? (s as z.ZodString).trim().min(1, 'Requerido') : s;
  }
  return s.optional().nullable();
}

export function contentSchema(t: Template, strict: boolean) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const sec of t.sections) {
    const fields: Record<string, z.ZodTypeAny> = {};
    for (const f of sec.fields) fields[f.key] = fieldSchema(f, strict);
    const obj = z.object(fields).strict();
    shape[sec.key] = strict && sec.fields.some((f) => f.required) ? obj : obj.optional();
  }
  return z.object(shape).strict();
}
