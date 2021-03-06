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

import AWS from 'aws-sdk';
import { HeadObjectRequest, PutBucketLifecycleConfigurationRequest, PutObjectRequest } from 'aws-sdk/clients/s3';
import { isArray, isString } from 'lodash';
import makeError from 'make-error';
import { Readable } from 'stream';
import urljoin from 'url-join';

import { S3_ASSETS_BUCKET, S3_ENDPOINT_URL, S3_MAP_TILES_TTL } from '../config';
import { getLogger } from '../logging';

const logger = getLogger();

export const S3Error = makeError('S3Error');
export const UploadError = makeError('UploadError');

const s3 = new AWS.S3({ s3ForcePathStyle: true, endpoint: S3_ENDPOINT_URL });

interface StorageEvent {
  bucket: string;
  key: string;
  storageUrl: string;
  etag: string;
  metadata?: { [key: string]: string };
}

/**
 * Uploads an arbitrarily sized buffer, blob, or stream, using intelligent
 * concurrent handling of parts if the payload is large enough.
 */
export const s3StreamUpload = async (
  readable: Readable,
  keyPath: string,
  contentType: string,
  metadata?: { [key: string]: string },
  bucketName: string = S3_ASSETS_BUCKET
): Promise<StorageEvent> => {
  try {
    const config: PutObjectRequest = {
      Bucket: bucketName,
      Key: keyPath,
      Body: readable,
      ContentType: contentType,
      ACL: 'public-read',
      CacheControl: `max-age=${S3_MAP_TILES_TTL}`,
    };
    if (metadata) {
      config.Metadata = metadata;
    }
    const meta = await s3.upload(config).promise();

    logger.debug(`[s3StreamUpload] successfully uploaded: ${meta.Location}`);

    return {
      key: meta.Key,
      bucket: meta.Bucket,
      etag: meta.ETag,
      storageUrl: getStorageUrl(meta.Bucket, meta.Key),
    };
  } catch (err) {
    logger.error(err.message);
    throw new UploadError(`Failed to upload file to S3. ${err.message}`);
  }
};

/**
 * Return the metadata of an object if it exist.
 */
export const s3KeyExists = async (keyPath: string, bucketName: string = S3_ASSETS_BUCKET): Promise<StorageEvent> => {
  const config: HeadObjectRequest = {
    Bucket: bucketName,
    Key: keyPath,
  };
  try {
    const meta = await s3.headObject(config).promise();

    logger.debug(`[s3KeyExists] found S3 key ${meta.ContentLength} bytes: ${keyPath}`);

    return {
      key: config.Key,
      bucket: config.Bucket,
      etag: meta.ETag,
      metadata: meta.Metadata,
      storageUrl: getStorageUrl(config.Bucket, config.Key),
    };
  } catch (err) {
    logger.error(err.message);
    if (err.code !== 'NotFound') {
      throw new UploadError(`Failed to request file meta from S3. ${err.message}`);
    }
  }
};

/**
 * Creates a new lifecycle configuration for the bucket or replaces an
 * existing lifecycle configuration.
 * @param bucketName: name of the bucket.
 * @param objectKeyPrefix: object key name prefix.
 * @param expDaysTTL: lifetime, in days, of the objects in the bucket.
 */
export const createLifecyclePolicy = async (
  objectKeyPrefix: string | string[],
  bucketName: string = S3_ASSETS_BUCKET,
  expDaysTTL: number = 1
): Promise<boolean> => {
  let keyPrefixes: string[];
  if (isString(objectKeyPrefix)) {
    keyPrefixes = [<string>objectKeyPrefix];
  } else if (isArray(objectKeyPrefix) && objectKeyPrefix.every(isString)) {
    keyPrefixes = <string[]>objectKeyPrefix;
  } else {
    throw new S3Error('Unsupported object key prefix format.');
  }
  logger.debug('[createLifecyclePolicy] object key prefix: %O', keyPrefixes);

  // Specifies lifecycle configuration rules for an Amazon S3 bucket.
  const params: PutBucketLifecycleConfigurationRequest = {
    Bucket: bucketName,
    LifecycleConfiguration: {
      Rules: keyPrefixes.map((prefix: string) => ({
        Expiration: {
          Days: expDaysTTL,
        },
        Filter: {
          Prefix: prefix,
        },
        Status: 'Enabled',
      })),
    },
  };

  let success: boolean = true;
  try {
    const res = await s3.putBucketLifecycleConfiguration(params).promise();
    logger.debug('[createLifecyclePolicy] client responded with: %s', JSON.stringify(res));
  } catch (err) {
    success = false;
    logger.error(err.message);
  }
  return success;
};

/**
 * Helper function.
 * @param bucket
 * @param key
 */
const getStorageUrl = (bucket: string, key: string): string => {
  return urljoin(S3_ENDPOINT_URL, bucket, key);
};
