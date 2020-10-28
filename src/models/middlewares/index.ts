/*
  Copyright 2018-2020 National Geographic Society

  Use of this software does not constitute endorsement by National Geographic
  Society (NGS). The NGS name and NGS logo may not be used for any purpose without
  written permission from NGS.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at

      https://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed
  under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
  CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import { Model, SchemaOptions } from 'mongoose';
import { Document } from 'mongoose';

import { DocumentError } from '../../errors';
import { getLogger } from '../../logging';

const logger = getLogger();

/**
 * Mongo default schema options.
 */
export const schemaOptions: SchemaOptions = {
  toObject: {
    transform: function (doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    },
  },
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    },
  },
  timestamps: true,
  minimize: false, // store empty objects;
  collation: { locale: 'en_US', caseLevel: true, numericOrdering: true }, // case insensitive sorting, sort numeric substrings based on their numeric value;
};

/**
 * Validate document references.
 * References need to belong to the same workspace/organization.
 * @param model
 * @param refIds
 * @param organization
 */
export const checkWorkspaceRefs = async <T extends Document>(
  model: Model<T>,
  refIds: string[],
  organization: string
): Promise<void> => {
  if (!organization) {
    throw new Error('Missing required parameter: organization');
  }
  if (refIds && refIds.length) {
    logger.debug('[checkWorkspaceRefs] checking references for organization %s: %s', organization, refIds);

    const res: any[] = await model.find(<any>{ _id: { $in: refIds } }).select('organization');
    const isValid = res.every((r) => r?.organization === organization);
    if (!isValid) {
      throw new DocumentError('Could not save document. Invalid references saved on document.', 400);
    }
  }
};
